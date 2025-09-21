// src/core/metrics/middleware.js
// Coletor de métricas neutro do core (SEM “cheiro” de bot).
// - Seguro por padrão (no-op se não configurado)
// - Fila interna com backoff exponencial + jitter
// - Sinks: console | http (webhook)
// - API mínima: captureFromActions(actions, context)
//
// Como usar (já está no teu orquestrador):
//   const { captureFromActions } = await import("./metrics/middleware.js");
//   await captureFromActions(actions, { botId, jid, stage, variant, askedPrice, askedLink });
//
// ENV OPCIONAIS:
//   METRICS_SINK=console|http|none        (default: console em DEV, none em PROD se não definido)
//   METRICS_WEBHOOK_URL=https://...       (para sink http)
//   METRICS_BATCH_MAX=50                  (default: 50)
//   METRICS_FLUSH_MS=1500                 (default: 1500ms)
//   METRICS_DEBUG=true|false              (logs de debug)

const IS_PROD = process.env.NODE_ENV === "production";
const SINK = (process.env.METRICS_SINK || (IS_PROD ? "none" : "console")).toLowerCase();
const WEBHOOK_URL = process.env.METRICS_WEBHOOK_URL || "";
const BATCH_MAX = clampInt(process.env.METRICS_BATCH_MAX, 1, 1000, 50);
const FLUSH_MS = clampInt(process.env.METRICS_FLUSH_MS, 250, 10000, 1500);
const DEBUG = String(process.env.METRICS_DEBUG || "").toLowerCase() === "true";

// ------------- Utils -------------
function clampInt(v, min, max, dflt) {
  const n = Number(v);
  if (Number.isFinite(n)) return Math.min(max, Math.max(min, Math.trunc(n)));
  return dflt;
}
function nowIso() { return new Date().toISOString(); }
function jitter(ms, ratio = 0.25) {
  const delta = ms * ratio;
  return ms + Math.floor((Math.random() * 2 - 1) * delta);
}
function simpleHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
  return (h >>> 0).toString(36);
}

// ------------- Evento -> Sumarização -------------
/**
 * Converte as "actions" do orquestrador em eventos de métricas.
 */
function summarizeActions(actions = [], ctx = {}) {
  const out = [];
  const base = {
    ts: nowIso(),
    botId: ctx.botId || "unknown-bot",
    jid: ctx.jid || "unknown-user",
    stage: ctx.stage || null,
    variant: ctx.variant || null,
    askedPrice: !!ctx.askedPrice,
    askedLink: !!ctx.askedLink,
  };

  // Evento sintético de inbound (opcional)
  if (ctx._inboundMessage) {
    out.push({ ...base, type: "inbound_user_message", msgHash: simpleHash(String(ctx._inboundMessage || "")) });
  }

  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    const meta = a.meta || {};
    const evBase = { ...base, stage: meta.stage || base.stage, variant: meta.variant || base.variant };

    if (a.kind === "text") out.push({ ...evBase, type: "action_text", length: String(a.text || "").length });
    else if (a.kind === "image") out.push({ ...evBase, type: "action_image", hasCaption: !!a.caption });
    else if (a.kind === "audio" || a.kind === "voice") out.push({ ...evBase, type: "action_audio", voice: a.kind === "voice" });
    else out.push({ ...evBase, type: "action_other", kind: a.kind || "unknown" });
  }

  if (ctx.askedPrice || ctx.askedLink) {
    out.push({ ...base, type: "user_intent_flags", askedPrice: !!ctx.askedPrice, askedLink: !!ctx.askedLink });
  }

  return out;
}

// ------------- Fila com backoff -------------
const queue = [];
let flushing = false;
let flushTimer = null;
let backoffMs = 0;

function scheduleFlush(immediate = false) {
  if (flushing) return;
  if (flushTimer) clearTimeout(flushTimer);
  const delay = immediate ? 0 : (backoffMs > 0 ? jitter(backoffMs) : FLUSH_MS);
  flushTimer = setTimeout(() => { flushTimer = null; flush().catch(() => {}); }, delay);
}

async function flush() {
  if (flushing) return;
  if (!queue.length) return;

  flushing = true;
  let batch = []; // ← acessível no catch
  try {
    batch = queue.splice(0, BATCH_MAX);
    if (!batch.length) { backoffMs = 0; return; }

    if (SINK === "none") {
      if (DEBUG) console.log("[metrics] sink=none (descartado)", { count: batch.length });
      backoffMs = 0;
      return;
    }

    if (SINK === "console") {
      for (const ev of batch) console.log("[metrics]", JSON.stringify(ev));
      backoffMs = 0;
      return;
    }

    if (SINK === "http") {
      if (!WEBHOOK_URL) {
        if (DEBUG) console.warn("[metrics] WEBHOOK_URL ausente; descartando batch");
        backoffMs = 0;
        return;
      }
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok) throw new Error(`webhook ${res.status} ${res.statusText}`);
      backoffMs = 0;
      return;
    }

    // Sinks desconhecidos → trata como no-op
    if (DEBUG) console.warn("[metrics] sink desconhecido:", SINK, "— descartando");
    backoffMs = 0;
  } catch (err) {
    console.error("[metrics] flush erro:", err?.message || err);
    // devolve o batch para o início da fila, preservando ordem
    if (batch && batch.length) queue.unshift(...batch);
    // backoff exponencial (máx 60s)
    backoffMs = Math.min(60000, backoffMs ? Math.floor(backoffMs * 2) : 2000);
  } finally {
    flushing = false;
    if (queue.length) scheduleFlush(); // agenda próximo flush
  }
}

// ------------- API pública -------------
/**
 * Captura eventos a partir de uma lista de "actions" do orquestrador.
 * @param {Array<{kind:string, text?:string, url?:string, caption?:string, meta?:object}>} actions
 * @param {{botId:string, jid:string, stage?:string, variant?:string|null, askedPrice?:boolean, askedLink?:boolean, _inboundMessage?:string}} context
 */
export async function captureFromActions(actions = [], context = {}) {
  try {
    const events = summarizeActions(actions, context);
    for (const ev of events) queue.push(ev);

    if (queue.length >= BATCH_MAX) scheduleFlush(true);
    else scheduleFlush(false);

    if (DEBUG) console.log(`[metrics] queued=${queue.length} sink=${SINK} bmax=${BATCH_MAX}`);
  } catch (e) {
    // nunca propaga erro para não derrubar o orquestrador
    console.warn("[metrics] capture skip:", e?.message || e);
  }
}

// ------------- Export default (compat) -------------
export default { captureFromActions };

// ------------- Shutdown limpo (opcional) -------------
/** Chame no SIGINT/SIGTERM para enviar o que faltar. */
export async function flushMetricsNow() {
  try { await flush(); }
  catch (e) { console.warn("[metrics] flushMetricsNow:", e?.message || e); }
}
// ... mantenha tudo igual acima ...

// ------------- Getters opcionais p/ health -------------
export function getQueueSize() {
  return queue.length;
}
