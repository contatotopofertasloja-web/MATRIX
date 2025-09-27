// src/core/orchestrator.js
// Orquestrador neutro + amigável a flows, sem depender de flags ausentes.
// - Se flags.flow_only === true → usa só flows (sem LLM).
// - Carimbo [flow/...] visível por padrão (assume debug_labels=true se não existir).
// - Mantém tudo em try/catch e não quebra se métricas/outbox estiverem indisponíveis.

import { intentOf } from './intent.js';
import { callLLM } from './llm.js';
import { settings, BOT_ID } from './settings.js';
import { loadFlows } from './flow-loader.js';
import { polishReply, consolidateBubbles } from '../utils/polish.js';

// persistência (no-op se ausente)
let saveSession = async (_s) => {};
try {
  const mem = await import('./memory.js');
  saveSession = mem?.saveSession || saveSession;
} catch {}

// métricas (no-op se ausente)
let captureFromActions = async (_ctx, _actions) => {};
try {
  const mm = await import('./metrics/middleware.js');
  captureFromActions = mm?.captureFromActions || captureFromActions;
} catch {}

// prompts específicos por bot (opcional)
let buildPrompt = null;
try {
  const mod = await import(`../../configs/bots/${BOT_ID}/prompts/index.js`);
  buildPrompt = mod?.buildPrompt || mod?.default || null;
} catch {}

const DEFAULT_FALLBACK = 'Dei uma travadinha aqui, pode repetir? 💕';

function stageFromIntent(intention) {
  const t = String(intention || '').toLowerCase();
  if (/qualify|qualifica/.test(t))                        return 'qualificacao';
  if (/offer|oferta|pitch/.test(t))                       return 'oferta';
  if (/objection|obj(e|é)coes?/.test(t))                  return 'objecoes';
  if (/close|checkout|fechamento/.test(t))                return 'fechamento';
  if (/post|after|p[oó]s-?venda|pos-?venda/.test(t))      return 'posvenda';
  if (/delivery|entrega/.test(t))                         return 'entrega';
  if (/payment|pagamento/.test(t))                        return 'pagamento';
  if (/features|modo|como usar|caracter[ií]sticas/.test(t)) return 'features';
  return 'recepcao';
}

// injeta carimbo visível quando debugLabels estiver ativo
function withVisibleTag(text, tag, debugLabels) {
  const has = /\[[a-z]+\/.+?\]/i.test(String(text || ''));
  if (!debugLabels || !tag || has) return text;
  return `[${tag}] ${text}`;
}

export async function orchestrate(ctx = {}) {
  const { session = {}, from = '', text = '', meta = {} } = ctx;

  const flowOnly   = !!settings?.flags?.flow_only;
  // NOVO: se flags.debug_labels não existir, assume TRUE (útil p/ testes)
  const debugLabels =
    (settings?.flags && Object.prototype.hasOwnProperty.call(settings.flags, 'debug_labels'))
      ? !!settings.flags.debug_labels
      : true;

  // 1) Intenção e estágio
  const intent = intentOf(text || '');
  const stage  = stageFromIntent(meta?.stageHint || intent);

  // 2) Carrega flows
  let flows = {};
  try {
    flows = await loadFlows(BOT_ID);
  } catch (e) {
    console.warn('[orchestrator] loadFlows falhou:', e?.message || e);
  }

  // 3) Executa flow do estágio
  let reply = '';
  let replyMeta = null;
  let actionsFromFlow = null;

  const flowHandler =
    (flows && (flows[stage] || flows[intent?.toLowerCase?.()] || flows?.handle)) || null;

  try {
    if (typeof flowHandler === 'function') {
      const out = await flowHandler({
        userId: from,
        text: String(text || ''),
        settings,
        context: { session, meta, stage, intent, settings },
        send: (_to, _msg) => {}, // neutro
      });

      if (out && Array.isArray(out.actions)) {
        actionsFromFlow = out.actions;
      } else if (out && typeof out === 'object') {
        if (typeof out.reply === 'string') reply = out.reply;
        if (out.meta) replyMeta = out.meta;
      } else if (typeof out === 'string') {
        reply = out;
      }
    }
  } catch (err) {
    console.error('[orchestrator][flow][error]', err?.message || err);
  }

  // 4) Fallback: LLM (se permitido) ou silêncio controlado
  if (!reply && !actionsFromFlow) {
    if (!flowOnly) {
      try {
        if (typeof buildPrompt === 'function') {
          const built = (buildPrompt({
            stage, intent, message: String(text || ''), settings, meta,
          }) || {});
          const llm = await callLLM({ stage, system: built.system || '', prompt: built.user || '' });
          reply = llm?.text || '';
        } else {
          const system =
            'Você é uma atendente humana de vendas, simpática, objetiva e respeitosa. Nunca diga que é uma IA. PT-BR.';
          const prompt =
            `Mensagem do cliente: "${String(text || '').trim()}". ` +
            `Responda de forma breve e útil, no tom de consultora de vendas. ` +
            `Se aplicável, peça um dado do funil (CEP+cidade; interesse; etc.).`;
          const llm = await callLLM({ stage, system, prompt });
          reply = llm?.text || '';
        }
      } catch (err) {
        console.error('[orchestrator][llm][error]', err?.message || err);
      }
    } else {
      reply = '';
    }
  }

  // 5) Polish
  let polished = '';
  try {
    polished = polishReply(reply, { stage, settings, tag: replyMeta?.tag || null }) || reply;
  } catch (polErr) {
    console.warn('[orchestrator] polishReply falhou:', polErr?.message || polErr);
    polished = reply || '';
  }

  // 6) Actions
  let actions = [];

  if (actionsFromFlow && actionsFromFlow.length) {
    actions = actionsFromFlow.map((a) => ({
      type: a?.type || 'text',
      to: a?.to || from,
      text: withVisibleTag(a?.text || '', a?.meta?.tag || replyMeta?.tag, debugLabels),
      meta: {
        ...(a?.meta || {}),
        stage,
        intent,
        botId: BOT_ID,
      },
    }));
  } else {
    const textOut = polished || DEFAULT_FALLBACK;
    const bubbles = consolidateBubbles([
      withVisibleTag(textOut, replyMeta?.tag, debugLabels),
    ]);
    actions = bubbles.map((line) => ({
      type: 'text',
      to: from,
      text: line,
      meta: {
        stage,
        intent,
        botId: BOT_ID,
        ...(replyMeta ? { tag: replyMeta.tag } : {}),
      },
    }));
  }

  // 7) Persistência (best-effort)
  try {
    session.lastStage  = stage;
    session.lastIntent = intent;
    session.updatedAt  = Date.now();
    await saveSession(session);
  } catch (e) {
    console.warn('[orchestrator] saveSession falhou:', e?.message || e);
  }

  // 8) Métricas (nunca quebra)
  try {
    await captureFromActions(
      { botId: BOT_ID, from, stage, intent, variant: meta?.variant || null },
      actions
    );
  } catch (e) {
    console.warn('[orchestrator] metrics.captureFromActions falhou:', e?.message || e);
  }

  return { actions, stage, intent };
}

export default { orchestrate };
