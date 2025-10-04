// src/core/orchestrator.js
// Orquestrador neutro: múltiplas bolhas (out.replies), fallback para 'greet' no estágio inicial,
// polimento/sanitização e captura de métricas opcionais.

import { intentOf } from './intent.js';
import { callLLM } from './llm.js';
import { settings, BOT_ID } from './settings.js';
import { loadFlows } from './flow-loader.js';
import { polishReply, consolidateBubbles, sanitizeOutbound } from '../utils/polish.js';

const DEFAULT_FALLBACK = 'Consegue repetir por gentileza?';

// -------- helpers --------
function stageFromIntent(intention) {
  const t = String(intention || '').toLowerCase();
  if (/qualify|qualifica/.test(t)) return 'qualificacao';
  if (/offer|oferta|pitch/.test(t)) return 'oferta';
  if (/objection|obj(e|é)coes?/.test(t)) return 'objecoes';
  if (/close|checkout|fechamento/.test(t)) return 'fechamento';
  if (/post|after|p[oó]s-?venda|pos-?venda/.test(t)) return 'posvenda';
  if (/delivery|entrega/.test(t)) return 'entrega';
  if (/payment|pagamento/.test(t)) return 'pagamento';
  if (/features|modo|como usar|caracter[ií]sticas/.test(t)) return 'features';
  return 'recepcao';
}

function withVisibleTag(text, tag, debugLabels, fallbackTag) {
  const has = /\[[a-z]+\/.+?\]/i.test(String(text || ''));
  const useTag = tag || fallbackTag;
  if (!debugLabels || !useTag || has) return text;
  return `[${useTag}] ${text}`;
}

// lazy loaders (evitam top-level await)
let _memoryLoaded = null;
async function getMemory() {
  if (_memoryLoaded) return _memoryLoaded;
  try { _memoryLoaded = await import('./memory.js'); }
  catch { _memoryLoaded = {}; }
  return _memoryLoaded;
}

let _metricsLoaded = null;
async function getMetrics() {
  if (_metricsLoaded) return _metricsLoaded;
  try { _metricsLoaded = await import('./metrics/middleware.js'); }
  catch { _metricsLoaded = {}; }
  return _metricsLoaded;
}

let _promptsMod = null;
async function getPromptsBuilder() {
  if (_promptsMod) return _promptsMod;
  try { _promptsMod = await import(`../../configs/bots/${BOT_ID}/prompts/index.js`); }
  catch { _promptsMod = {}; }
  return _promptsMod;
}

// -------- main --------
export async function orchestrate(ctx = {}) {
  const { session = {}, from = '', text = '', meta = {} } = ctx;

  const flowOnly = !!settings?.flags?.flow_only;
  const debugLabels =
    (settings?.flags && Object.prototype.hasOwnProperty.call(settings.flags, 'debug_labels'))
      ? !!settings.flags.debug_labels
      : true;

  // carrega utilitários opcionais
  const { saveSession = async () => {} } = await getMemory();
  const { captureFromActions = async () => {} } = await getMetrics();
  const { buildPrompt = null, default: buildPromptDefault = null } = await getPromptsBuilder();
  const buildPromptFn = buildPrompt || buildPromptDefault || null;

  const intent = intentOf(text || '');
  const stage  = stageFromIntent(meta?.stageHint || intent);

  let flows = {};
  try { flows = await loadFlows(BOT_ID); }
  catch (e) { console.warn('[orchestrator] loadFlows:', e?.message || e); }

  let reply = '';
  let replyMeta = null;
  let actionsFromFlow = null;
  let repliesFromFlow = null;

  // handler: tenta stage → intent → greet → handle
  const flowHandler =
    (typeof flows[stage] === 'function' && flows[stage]) ||
    (typeof flows[intent?.toLowerCase?.()] === 'function' && flows[intent.toLowerCase()]) ||
    (typeof flows.greet === 'function' && flows.greet) ||
    (typeof flows.handle === 'function' && flows.handle) ||
    null;

  try {
    if (flowHandler) {
      const out = await flowHandler({
        userId: from, jid: from,
        text: String(text || ''),
        state: session.state || (session.state = {}),
        settings,
        context: { session, meta, stage, intent, settings },
      });

      if (out && Array.isArray(out.actions)) {
        actionsFromFlow = out.actions;
      } else if (out && Array.isArray(out.replies)) {
        repliesFromFlow = out.replies;
        if (out.meta) replyMeta = out.meta;
      } else if (out && typeof out === 'object') {
        if (typeof out.reply === 'string') reply = out.reply;
        if (out.meta) replyMeta = out.meta;
      } else if (typeof out === 'string') {
        reply = out;
      }
    }
  } catch (err) {
    console.error('[orchestrator][flow]', err?.stack || err?.message || err);
  }

  // nenhum retorno do flow → opcional LLM (se NÃO for flow_only)
  if (!reply && !actionsFromFlow && !repliesFromFlow) {
    if (!flowOnly) {
      try {
        if (typeof buildPromptFn === 'function') {
          const built = (buildPromptFn({ stage, intent, message: String(text || ''), settings, meta }) || {});
          const llm   = await callLLM({ stage, system: built.system || '', prompt: built.user || '' });
          reply = llm?.text || '';
        } else {
          const system = 'Você é uma atendente humana de vendas. Nunca diga que é IA. PT-BR.';
          const prompt = `Mensagem: "${String(text || '').trim()}". Responda breve, educada e objetiva.`;
          const llm    = await callLLM({ stage, system, prompt });
          reply = llm?.text || '';
        }
      } catch (err) {
        console.error('[orchestrator][llm]', err?.stack || err?.message || err);
      }
    } else {
      reply = '';
    }
  }

  // polimento do single-reply (quando houver)
  let polished = '';
  try { polished = polishReply(reply, { stage, settings, tag: replyMeta?.tag || null }) || reply; }
  catch { polished = reply || ''; }

  // single-reply passa pelo sanitizer (com controle de preço/link por estágio + tag)
  const allowPriceSingle =
    (stage === 'oferta' || stage === 'fechamento' || /^flow\/offer#/i.test(String(replyMeta?.tag || '')));
  const allowLinkSingle  =
    (stage === 'fechamento' || /link|checkout|coinzz|logzz/i.test(String(polished)));

  const finalText  = sanitizeOutbound(polished, {
    allowLink: allowLinkSingle,
    allowPrice: allowPriceSingle,
    tag: replyMeta?.tag || null,
  });

  const defaultTag = `flow/${stage}`;
  let actions = [];

  if (actionsFromFlow && actionsFromFlow.length) {
    actions = actionsFromFlow.map((a) => {
      const tag = (a?.meta?.tag || replyMeta?.tag || defaultTag);
      const allowPrice = (stage === 'oferta' || stage === 'fechamento' || /^flow\/offer#/i.test(String(tag || '')));
      const allowLink  = (stage === 'fechamento' || /link|checkout|coinzz|logzz/i.test(String(a?.text || a?.reply || '')));
      const txtSan = sanitizeOutbound((a?.text || a?.reply || ''), { allowLink, allowPrice, tag });
      return {
        type: a?.type || 'text',
        to: a?.to || from,
        text: withVisibleTag(txtSan, tag, debugLabels, defaultTag),
        meta: { ...(a?.meta || {}), stage, intent, botId: BOT_ID, tag },
      };
    });
  } else if (repliesFromFlow && repliesFromFlow.length) {
    actions = repliesFromFlow
      .map((r) => {
        const line = (r && (r.reply ?? r.text)) || '';
        const tag = (r?.meta?.tag || replyMeta?.tag || defaultTag);
        const allowPrice = (stage === 'oferta' || stage === 'fechamento' || /^flow\/offer#/i.test(String(tag || '')));
        const allowLink  = (stage === 'fechamento' || /link|checkout|coinzz|logzz/i.test(String(line)));
        const sanitized  = sanitizeOutbound(String(line || ''), { allowLink, allowPrice, tag });
        const txt        = withVisibleTag(sanitized, tag, debugLabels, defaultTag);
        return {
          type: 'text',
          to: from,
          text: txt,
          meta: { ...(r?.meta || {}), stage, intent, botId: BOT_ID, tag },
        };
      })
      .filter(a => a.text && a.text.trim());
  }

  // fallback final (single bubble)
  if (!actions.length) {
    const textOut = finalText || DEFAULT_FALLBACK;
    const bubbles = consolidateBubbles([withVisibleTag(textOut, (replyMeta?.tag), debugLabels, defaultTag)]);
    actions = bubbles.map((line) => ({
      type: 'text',
      to: from,
      text: line,
      meta: { stage, intent, botId: BOT_ID, tag: (replyMeta?.tag || defaultTag) },
    }));
  }

  try {
    session.lastStage  = stage;
    session.lastIntent = intent;
    session.updatedAt  = Date.now();
    await saveSession(session);
  } catch (e) {
    console.warn('[orchestrator] saveSession:', e?.message || e);
  }

  try {
    await captureFromActions({ botId: BOT_ID, from, stage, intent, variant: meta?.variant || null }, actions);
  } catch (e) {
    console.warn('[orchestrator] metrics:', e?.message || e);
  }

  return { actions, stage, intent };
}

export default { orchestrate };
