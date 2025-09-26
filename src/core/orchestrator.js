// src/core/orchestrator.js
// Orquestrador neutro do funil (greet → qualify → offer → objection → close → post_sale)
// - Escolhe estágio (intent)
// - Gera prompt (prompts da bot) OU chama flow dedicado (se existir)
// - Chama LLM (core/llm.js) com compat 5.x ⇄ 4.x
// - Faz polish seguro do texto
// - Persiste contexto de sessão (best-effort)
// - Retorna uma lista de "actions" para o index/router enviar

import { intentOf } from './intent.js';
import { callLLM } from './llm.js';
import { settings, BOT_ID } from './settings.js';
import { loadFlows } from './flow-loader.js';
import { polishReply, consolidateBubbles } from '../utils/polish.js';

// persistência opcional (no-op se ausente)
let saveSession = async (_s) => {};
try {
  const mem = await import('./memory.js');
  saveSession = mem?.saveSession || saveSession;
} catch {
  // segue sem persistência explícita
}

// prompts específicos por bot (opcional)
let buildPrompt = null;
try {
  const mod = await import(`../../configs/bots/${BOT_ID}/prompts/index.js`);
  buildPrompt = mod?.buildPrompt || mod?.default || null;
} catch {
  // se não existir, usamos flows ou fallback direto ao LLM com prompt simples
}

const DEFAULT_FALLBACK = 'Dei uma travadinha aqui, pode repetir? 💕';

function stageFromIntent(intention) {
  // mapeia intents para chaves canônicas do core/llm (compat com settings)
  const t = String(intention || '').toLowerCase();
  if (/qualify|qualifica/.test(t))   return 'qualificacao';
  if (/offer|oferta|pitch/.test(t))  return 'oferta';
  if (/objection|obj(e|é)coes?/.test(t)) return 'objecoes';
  if (/close|checkout|fechamento/.test(t)) return 'fechamento';
  if (/post|after|p[oó]s-?venda|pos-?venda/.test(t)) return 'posvenda';
  if (/delivery|entrega/.test(t))    return 'entrega';
  if (/payment|pagamento/.test(t))   return 'pagamento';
  if (/features|modo|como usar|caracter[ií]sticas/.test(t)) return 'features';
  return 'recepcao';
}

// API principal
// ctx esperado: { session, from, text, meta }
// retorna: { actions: [ { type:'text'|'image', to, text|url|caption } ], stage, intent }
export async function orchestrate(ctx = {}) {
  const { session = {}, from = '', text = '', meta = {} } = ctx;

  // 1) Intenção e estágio
  const intent = intentOf(text || '');
  const stage  = stageFromIntent(intent);

  // 2) Carrega flows da bot (dinâmico; neutro no core)
  let flows = {};
  try {
    flows = await loadFlows(BOT_ID); // { greet, qualify, offer, ... } se existirem
  } catch (e) {
    console.warn('[orchestrator] loadFlows falhou:', e?.message || e);
  }

  // 3) Tenta flow dedicado do estágio primeiro
  let reply = '';
  const flowHandler =
    flows?.[stage] ||
    flows?.[intent?.toLowerCase?.()] ||
    null;

  try {
    if (typeof flowHandler === 'function') {
      const out = await flowHandler({
        userId: from,
        text: String(text || ''),
        context: { session, meta, stage, intent },
      });
      if (typeof out === 'string') reply = out;
    }

    // 4) Se o flow não resolveu, usa prompts/LLM
    if (!reply) {
      if (typeof buildPrompt === 'function') {
        const { system, user } = buildPrompt({
          stage,
          intent,
          message: String(text || ''),
          settings,
        }) || {};
        const llm = await callLLM({ stage, system, prompt: user });
        reply = llm?.text || '';
      } else {
        // prompt mínimo (fallback) — neutro
        const system =
          'Você é uma atendente humana de vendas, simpática, objetiva e respeitosa. Nunca diga que é uma IA ou assistente virtual. Use português do Brasil.';
        const prompt =
          `Mensagem do cliente: "${String(text || '').trim()}". ` +
          `Responda de forma breve e útil, no tom de consultora de vendas. ` +
          `Se aplicável, peça um dos dados do funil (tipo de cabelo: liso/ondulado/cacheado/crespo; ou CEP; ou interesse).`;
        const llm = await callLLM({ stage, system, prompt });
        reply = llm?.text || '';
      }
    }
  } catch (err) {
    // loga de forma clara para debug (sem vazar para cliente)
    console.error('[orchestrator][llm/flow][error]', err?.status || '', err?.message || err);
    reply = '';
  }

  // 5) Polish seguro (nunca deixa quebrar)
  const polished = polishReply(reply, { stage, settings });

  // 6) Constrói actions (sempre 1 bolha no core; se quiser multi-bolha, flows podem quebrar)
  const lines = consolidateBubbles(polished ? [polished] : [DEFAULT_FALLBACK]);
  const actions = lines.map((line) => ({
    type: 'text',
    to: from,
    text: line,
    meta: { stage, intent, botId: BOT_ID },
  }));

  // 7) Persiste estado (best-effort)
  try {
    session.lastStage = stage;
    session.lastIntent = intent;
    session.updatedAt = Date.now();
    await saveSession(session);
  } catch (e) {
    console.warn('[orchestrator] saveSession falhou:', e?.message || e);
  }

  return { actions, stage, intent };
}

export default { orchestrate };
