// src/core/orchestrator.js
// Orquestrador neutro com flow_only e carimbo visível ([flow/<stage>]).
// Polish + liberação de preço/link nas fases de oferta/fechamento.

import { intentOf } from './intent.js';
import { callLLM } from './llm.js';
import { settings, BOT_ID } from './settings.js';
import { loadFlows } from './flow-loader.js';
import { polishReply, consolidateBubbles, sanitizeOutbound } from '../utils/polish.js';

let saveSession = async (_s) => {};
try { const mem = await import('./memory.js'); saveSession = mem?.saveSession || saveSession; } catch {}

let captureFromActions = async (_ctx, _actions) => {};
try { const mm = await import('./metrics/middleware.js'); captureFromActions = mm?.captureFromActions || captureFromActions; } catch {}

let buildPrompt = null;
try { const mod = await import(`../../configs/bots/${BOT_ID}/prompts/index.js`); buildPrompt = mod?.buildPrompt || mod?.default || null; } catch {}

const DEFAULT_FALLBACK = 'Consegue repetir por gentileza?';

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

export async function orchestrate(ctx = {}) {
  const { session = {}, from = '', text = '', meta = {} } = ctx;

  const flowOnly = !!settings?.flags?.flow_only;
  const debugLabels =
    (settings?.flags && Object.prototype.hasOwnProperty.call(settings.flags, 'debug_labels'))
      ? !!settings.flags.debug_labels
      : true;

  const intent = intentOf(text || '');
  const stage  = stageFromIntent(meta?.stageHint || intent);

  let flows = {};
  try { flows = await loadFlows(BOT_ID); } catch (e) { console.warn('[orchestrator] loadFlows:', e?.message || e); }

  let reply = ''; let replyMeta = null; let actionsFromFlow = null;
  const flowHandler = (flows && (flows[stage] || flows[intent?.toLowerCase?.()] || flows?.handle)) || null;

  try {
    if (typeof flowHandler === 'function') {
      const out = await flowHandler({
        userId: from, jid: from,
        text: String(text || ''),
        state: session.state || (session.state = {}),
        settings,
        context: { session, meta, stage, intent, settings },
      });
      if (out && Array.isArray(out.actions)) actionsFromFlow = out.actions;
      else if (out && typeof out === 'object') { if (typeof out.reply === 'string') reply = out.reply; if (out.meta) replyMeta = out.meta; }
      else if (typeof out === 'string') reply = out;
    }
  } catch (err) { console.error('[orchestrator][flow]', err?.message || err); }

  if (!reply && !actionsFromFlow) {
    if (!flowOnly) {
      try {
        if (typeof buildPrompt === 'function') {
          const built = (buildPrompt({ stage, intent, message: String(text || ''), settings, meta }) || {});
          const llm = await callLLM({ stage, system: built.system || '', prompt: built.user || '' });
          reply = llm?.text || '';
        } else {
          const system = 'Você é uma atendente humana de vendas. Nunca diga que é IA. PT-BR.';
          const prompt = `Mensagem: "${String(text || '').trim()}". Responda breve, educada e objetiva.`;
          const llm = await callLLM({ stage, system, prompt });
          reply = llm?.text || '';
        }
      } catch (err) { console.error('[orchestrator][llm]', err?.message || err); }
    } else {
      reply = '';
    }
  }

  let polished = '';
  try { polished = polishReply(reply, { stage, settings, tag: replyMeta?.tag || null }) || reply; }
  catch { polished = reply || ''; }

  const allowPrice = (stage === 'oferta' || stage === 'fechamento');
  const allowLink  = (stage === 'fechamento' || /link|checkout|coinzz|logzz/i.test(String(polished)));
  const finalText  = sanitizeOutbound(polished, { allowLink, allowPrice });

  const defaultTag = `flow/${stage}`;
  let actions = [];
  if (actionsFromFlow && actionsFromFlow.length) {
    actions = actionsFromFlow.map((a) => ({
      type: a?.type || 'text',
      to: a?.to || from,
      text: withVisibleTag(a?.text || '', (a?.meta?.tag || replyMeta?.tag), debugLabels, defaultTag),
      meta: { ...(a?.meta || {}), stage, intent, botId: BOT_ID, tag: (a?.meta?.tag || replyMeta?.tag || defaultTag) },
    }));
  } else {
    const textOut = finalText || DEFAULT_FALLBACK;
    const bubbles = consolidateBubbles([withVisibleTag(textOut, (replyMeta?.tag), debugLabels, defaultTag)]);
    actions = bubbles.map((line) => ({ type: 'text', to: from, text: line, meta: { stage, intent, botId: BOT_ID, tag: (replyMeta?.tag || defaultTag) } }));
  }

  try {
    session.lastStage = stage;
    session.lastIntent = intent;
    session.updatedAt = Date.now();
    await saveSession(session);
  } catch (e) { console.warn('[orchestrator] saveSession:', e?.message || e); }

  try { await captureFromActions({ botId: BOT_ID, from, stage, intent, variant: meta?.variant || null }, actions); }
  catch (e) { console.warn('[orchestrator] metrics:', e?.message || e); }

  return { actions, stage, intent };
}

export default { orchestrate };
