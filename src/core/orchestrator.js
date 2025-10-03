// src/core/orchestrator.js
import { intentOf } from './intent.js';
import { callLLM } from './llm.js';
import { settings, BOT_ID } from './settings.js';
import { loadFlows } from './flow-loader.js';
import { polishReply, consolidateBubbles, sanitizeOutbound } from '../utils/polish.js';

const DEFAULT_FALLBACK = 'Consegue repetir por gentileza?';

// ... (helpers e lazy-loaders inalterados) ...

export async function orchestrate(ctx = {}) {
  const { session = {}, from = '', text = '', meta = {} } = ctx;

  const flowOnly = !!settings?.flags?.flow_only;
  const debugLabels =
    (settings?.flags && Object.prototype.hasOwnProperty.call(settings.flags, 'debug_labels'))
      ? !!settings.flags.debug_labels
      : true;

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

  // LLM opcional (se flow_only = false) — inalterado
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

  // Polimento/sanitização do SINGLE reply (mantido)
  let polished = '';
  try { polished = polishReply(reply, { stage, settings, tag: replyMeta?.tag || null }) || reply; }
  catch { polished = reply || ''; }

  const allowPriceSingle = (stage === 'oferta' || stage === 'fechamento');
  const allowLinkSingle  = (stage === 'fechamento' || /link|checkout|coinzz|logzz/i.test(String(polished)));
  const finalText        = sanitizeOutbound(polished, { allowLink: allowLinkSingle, allowPrice: allowPriceSingle });

  const defaultTag = `flow/${stage}`;
  let actions = [];

  // Actions vindas do flow (quando for array de bolhas)
  if (actionsFromFlow && actionsFromFlow.length) {
    actions = actionsFromFlow.map((a) => ({
      type: a?.type || 'text',
      to: a?.to || from,
      text: withVisibleTag(a?.text || a?.reply || '', (a?.meta?.tag || replyMeta?.tag), debugLabels, defaultTag),
      meta: { ...(a?.meta || {}), stage, intent, botId: BOT_ID, tag: (a?.meta?.tag || replyMeta?.tag || defaultTag) },
    }));
  } else if (repliesFromFlow && repliesFromFlow.length) {
    actions = repliesFromFlow
      .map((r) => {
        // r pode ser:
        // 1) string
        // 2) { reply: 'texto', meta? }
        // 3) { reply: { reply: 'texto', meta: {...} } }  <- tagReply embrulhado
        let line = '';
        let bubbleMeta = {};

        if (typeof r === 'string') {
          line = r;
        } else if (r && typeof r.reply === 'string') {
          line = r.reply;
          bubbleMeta = { ...(r.meta || {}) };
        } else if (r && typeof r.reply === 'object' && r.reply) {
          // Corrige caso tenha vindo { reply: { reply, meta } }
          line = r.reply.reply || '';
          bubbleMeta = { ...(r.reply.meta || {}), ...(r.meta || {}) };
        } else if (r && typeof r.text === 'string') {
          line = r.text;
          bubbleMeta = { ...(r.meta || {}) };
        }

        const bubbleTag   = bubbleMeta.tag || replyMeta?.tag || defaultTag;
        const bubbleStage = bubbleMeta.stage || stage;

        // Polimento + sanização POR BOLHA
        let polishedBubble = '';
        try { polishedBubble = polishReply(line, { stage: bubbleStage, settings, tag: bubbleTag }) || line; }
        catch { polishedBubble = line || ''; }

        const isOfferishMeta =
          (bubbleMeta.stage === 'oferta') ||
          /^flow\/offer#/i.test(String(bubbleTag)) ||
          /^flow\/fechamento#/i.test(String(bubbleTag));

        const allowPrice = isOfferishMeta || bubbleStage === 'oferta' || bubbleStage === 'fechamento';
        const allowLink  = isOfferishMeta || bubbleStage === 'fechamento' || /link|checkout|coinzz|logzz/i.test(String(polishedBubble));
        const finalLine  = sanitizeOutbound(polishedBubble, { allowLink, allowPrice });

        const txt = withVisibleTag(finalLine, bubbleTag, debugLabels, defaultTag);

        return {
          type: 'text',
          to: from,
          text: txt,
          meta: { ...bubbleMeta, stage: bubbleStage, intent, botId: BOT_ID, tag: bubbleTag },
        };
      })
      .filter(a => a.text && a.text.trim());
  }

  // Fallback final (single bubble)
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
