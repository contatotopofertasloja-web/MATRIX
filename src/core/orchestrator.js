// src/core/orchestrator.js
// Orquestrador "flows-first": prioriza flows; hooks/fallback só se não houver ação.
// Mantém lock anti-rajada, persistência e telemetria. NÃO mexe no texto dos flows.

import {
  getSession, saveSession,
  normalizeStage
} from "./fsm.js";
import settings from "./settings.js";

const BOT_ID = process.env.BOT_ID || settings?.bot_id || "claudia";

// ---------- Concurrency / anti-rajada ----------
const LOCK_MS = 8000;
const DEBOUNCE_MS_INBOUND = 3500;
const SAME_REPLY_MS = 8000;

const locks = new Map();
function tryLock(key) {
  const now = Date.now();
  const last = locks.get(key) || 0;
  if (now - last < LOCK_MS) return false;
  locks.set(key, now);
  return true;
}
function release(key) { locks.delete(key); }

function shouldDebounceInbound(session, msg) {
  const now = Date.now();
  const lastTxt = session?.flags?.last_user_text || "";
  const lastTs  = session?.flags?.last_user_ts || 0;
  const same    = lastTxt === msg;
  const close   = (now - lastTs) < DEBOUNCE_MS_INBOUND;
  return same && close;
}
function markInbound(session, msg) {
  session.flags = session.flags || {};
  session.flags.last_user_text = msg;
  session.flags.last_user_ts   = Date.now();
}
function shouldBlockSameReply(session, replyText) {
  const now = Date.now();
  const last = session?.flags?.last_reply_text || "";
  const lastTs = session?.flags?.last_reply_ts || 0;
  const same = last === replyText;
  const close = (now - lastTs) < SAME_REPLY_MS;
  return same && close;
}
function markReply(session, replyText) {
  session.flags = session.flags || {};
  session.flags.last_reply_text = replyText;
  session.flags.last_reply_ts   = Date.now();
}

// ---------- Helpers ----------
function mapStageName(s) {
  const k = String(s || "greet").toLowerCase();
  if (k === "qualify") return "qualificacao";
  if (k === "offer") return "offer";
  if (k === "close" || k === "fechamento") return "close";
  if (k === "postsale" || k === "posvenda") return "postsale";
  if (k === "oferta") return "offer";
  if (k === "qualificacao") return "qualificacao";
  return "greet";
}

function buildOutbox(actions, stage, variant=null) {
  return {
    publish: async (msg) => {
      if (!msg) return;
      // normaliza image
      if (msg.kind === "image" || msg.type === "image") {
        const url = msg.payload?.url || msg.url;
        const caption = msg.payload?.caption || msg.caption || "";
        if (url) actions.push({ kind: "image", url, caption, meta: { stage, variant, source: `flow/${stage}` } });
        return;
      }
      // normaliza text
      if (msg.kind === "text" || typeof msg === "string") {
        const text = typeof msg === "string" ? msg : (msg.payload?.text || msg.text || "");
        if (text) actions.push({ kind: "text", text, meta: { stage, variant, source: `flow/${stage}` } });
        return;
      }
    }
  };
}

async function runFlow(botId, stage, ctxBase, actions) {
  const file =
    stage === "qualificacao" ? "qualify" :
    stage === "offer"        ? "offer"   :
    stage === "close"        ? "close"   :
    stage === "postsale"     ? "postsale": "greet";

  let fn = null;
  try {
    const mod = await import(`../../configs/bots/${botId}/flow/${file}.js`);
    fn = mod?.default || mod?.[file] || null;
  } catch { fn = null; }
  if (!fn) return null;

  const ctx = {
    ...ctxBase,
    meta: { variant: null }
  };

  const res = await fn(ctx);
  if (!res) return null;

  // se o flow devolveu reply como string, empilha
  if (res.reply) {
    actions.push({
      kind: "text",
      text: String(res.reply || ""),
      meta: { stage: file, variant: null, source: `flow/${file}` }
    });
  }
  return { res, file };
}

export async function orchestrate({ jid, text }) {
  if (!tryLock(jid)) return [];
  const actions = [];
  try {
    const session = await getSession({ botId: BOT_ID, userId: jid, createIfMissing: true });
    session.flags = session.flags || {};
    session.flow  = session.flow  || {};

    const msg = String(text || "");

    // debounce do mesmo input
    if (shouldDebounceInbound(session, msg)) return [];
    markInbound(session, msg);

    // 1) resolve estágio
    let stage = mapStageName(normalizeStage(session.stage));

    // 2) executa FLOW do estágio atual (greet já envia foto 1x dentro do próprio flow)
    const outbox = buildOutbox(actions, stage, null);
    const flowRun = await runFlow(BOT_ID, stage, { settings, outbox, jid, state: session.flow, text: msg }, actions);

    // 3) se o flow não produziu nenhuma ação → fallback via hooks (exceto greet)
    if (!actions.length) {
      try {
        const mod = await import(`../../configs/bots/${BOT_ID}/hooks.js`);
        const botHooks = mod?.hooks || mod?.default?.hooks || null;
        if (botHooks?.fallbackText && stage !== "greet") {
          const fb = await botHooks.fallbackText({ stage, settings });
          if (fb && fb.trim()) {
            actions.push({ kind: "text", text: fb.trim(), meta: { stage, source: "hooks" } });
          }
        }
      } catch { /* sem hooks, segue */ }
    }

    // 4) fallback local se ainda vazio
    if (!actions.length) {
      actions.push({
        kind: "text",
        text: "Consegue me contar rapidinho sobre seu cabelo? (liso, ondulado, cacheado ou crespo) 💛",
        meta: { stage, source: "fallback" }
      });
    }

    // 5) avanço de estágio (respeita `next` do flow; senão, padrão do funil)
    if (flowRun?.res?.next) {
      session.stage = mapStageName(flowRun.res.next);
    } else {
      const f = flowRun?.file;
      if (f === "greet")       session.stage = "qualificacao";
      else if (f === "qualify") session.stage = "offer";
      else if (f === "offer")   session.stage = "close";
      else if (f === "close")   session.stage = "postsale";
    }

    // 6) anti-flood de mesma resposta
    const lastText = actions.find(a => a.kind === "text")?.text || "";
    if (lastText && shouldBlockSameReply(session, lastText)) return [];
    if (lastText) markReply(session, lastText);

    // 7) persistência + métricas
    await saveSession(session);
    try {
      const { captureFromActions } = await import("./metrics/middleware.js");
      await captureFromActions(actions, {
        botId: BOT_ID, jid, stage: session.stage, variant: null
      });
    } catch { /* métricas são best effort */ }

    return actions;
  } finally {
    release(jid);
  }
}

export default { orchestrate };
