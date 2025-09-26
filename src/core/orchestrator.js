// src/core/orchestrator.js
// Orquestrador neutro do funil (greet → qualify → offer → objection → close → post_sale)
// - Escolhe estágio (intent)
// - Gera prompt (prompts da bot) OU chama flow dedicado (se existir)
// - Chama LLM (core/llm.js) com compat 5.x ⇄ 4.x
// - Faz polish seguro do texto
// - Persiste contexto de sessão (best-effort)
// - Retorna uma lista de "actions" para o index/router enviar
// - (Opcional) Captura métricas se src/core/metrics/middleware.js existir

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

// métricas opcionais (no-op se ausente)
let captureFromActions = async (_ctx, _actions) => {};
try {
  const mm = await import('./metrics/middleware.js');
  captureFromActions = mm?.captureFromActions || captureFromActions;
} catch {
  // sem métricas, tudo ok
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

// mapeia intents para chaves canônicas do core/llm (compat com settings)
function stageFromIntent(intention) {
  const t = String(intention || '').toLowerCase();

  if (/qualify|qualifica/.test(t))                        return 'qualificacao';
  if (/offer|oferta|pitch/.test(t))                       return 'oferta';
  if (/objection|obj(e|é)coes?/.test(t))                  return 'objecoes';
  if (/close|checkout|fechamento/.test(t))                return 'fechamento';
  if (/post|after|p[oó]s-?venda|pos-?venda/.test(t))      return 'posvenda';

  // intents auxiliares (não obrigatórias, mas úteis p/ prompt)
  if (/delivery|entrega/.test(t))                         return 'entrega';
  if (/payment|pagamento/.test(t))                        return 'pagamento';
  if (/features|modo|como usar|caracter[ií]sticas/.test(t)) return 'features';

  return 'recepcao';
}

/**
 * API principal
 * @param {Object} ctx
 *   - session: obj mutável de sessão (opcional)
 *   - from: jid/telefone do cliente
 *   - text: mensagem de entrada
 *   - meta: { variant?, stageHint? ... } metadados do pipeline
 * @returns {Promise<{ actions: Array, stage: string, intent: string }>}
 */
export async function orchestrate(ctx = {}) {
  const { session = {}, from = '', text = '', meta = {} } = ctx;

  // 1) Intenção e estágio
  const intent = intentOf(text || '');
  const stage  = stageFromIntent(meta?.stageHint || intent);

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
    (flows && (flows[stage] || flows[intent?.toLowerCase?.()] || flows?.handle)) || null;

  try {
    if (typeof flowHandler === 'function') {
      const out = await flowHandler({
        userId: from,
        text: String(text || ''),
        context: { session, meta, stage, intent, settings },
        send: (_to, _msg) => {
          // flows podem implementar envio direto; aqui mantemos neutro
        },
      });
      if (typeof out === 'string') reply = out;
      else if (out && typeof out === 'object' && typeof out.reply === 'string') reply = out.reply;
    }

    // 4) Se o flow não resolveu, usa prompts/LLM
    if (!reply) {
      if (typeof buildPrompt === 'function') {
        let system = '';
        let user   = '';
        try {
          const built = buildPrompt({
            stage,
            intent,
            message: String(text || ''),
            settings,
            meta,
          }) || {};
          system = built.system || '';
          user   = built.user   || '';
        } catch (bpErr) {
          console.warn('[orchestrator] buildPrompt falhou:', bpErr?.message || bpErr);
        }

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
  let polished = '';
  try {
    polished = polishReply(reply, { stage, settings });
  } catch (polErr) {
    console.warn('[orchestrator] polishReply falhou:', polErr?.message || polErr);
    polished = reply || '';
  }

  // 6) Constrói actions (sempre 1+ bolhas; flows podem quebrar em múltiplas)
  const bubbles = consolidateBubbles(polished ? [polished] : [DEFAULT_FALLBACK]);
  const actions = bubbles.map((line) => ({
    type: 'text',
    to: from,
    text: line,
    meta: {
      stage,
      intent,
      botId: BOT_ID,
      // preserva metadados úteis (ex.: A/B)
      variant: meta?.variant || null,
    },
  }));

  // 7) Persiste estado (best-effort)
  try {
    session.lastStage  = stage;
    session.lastIntent = intent;
    session.updatedAt  = Date.now();
    await saveSession(session);
  } catch (e) {
    console.warn('[orchestrator] saveSession falhou:', e?.message || e);
  }

  // 8) (Opcional) Captura métricas (no-op se middleware ausente)
  try {
    await captureFromActions(
      { botId: BOT_ID, from, stage, intent, variant: meta?.variant || null },
      actions
    );
  } catch (e) {
    // nunca quebra o fluxo por causa de métricas
    console.warn('[orchestrator] metrics.captureFromActions falhou:', e?.message || e);
  }

  return { actions, stage, intent };
}

export default { orchestrate };
