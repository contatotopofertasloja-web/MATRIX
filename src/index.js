// src/index.js — Matrix IA 2.0 (compacto + blindagens + multi-serviço)
// - Gating de hooks (core neutro; cada bot pluga só sua pasta)
// - Runner resiliente de flows (__handle/handle | obj.run | default function | pickFlow)
// - Sanitização de links com whitelist (settings.guardrails.allowed_links)
// - Anti-rajada de saída (reply_dedupe_ms)
// - Outbox (Redis) com fallback para envio direto
// - Orchestrator plugado (core neutro) ✅
// - WhatsApp QR/health/ops (forçar novo QR, logout+reset sessão)
// - (+) DEBUG: /wpp/debug, /wpp/last, /_ops/clear-debug (inspeção fromMe/remoteJid/participant)
// - (+) Métricas no /health: queue/sink/backoffMs

import express from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import {
  init as wppInit,
  adapter,
  isReady as wppReady,
  getQrDataURL,
  forceNewQr,
  logoutAndReset,
} from "./adapters/whatsapp/index.js";

import { createOutbox } from "./core/queue.js";
import { stopOutboxWorkers } from "./core/queue/dispatcher.js";

import { BOT_ID, settings } from "./core/settings.js";
import { loadFlows } from "./core/flow-loader.js";
import { intentOf } from "./core/intent.js";
import { callLLM } from "./core/llm.js";
import { getBotHooks } from "./core/bot-registry.js";
import { orchestrate } from "./core/orchestrator.js";
import { flushMetricsNow, getQueueSize, getSink, getBackoffMs } from "./core/metrics/middleware.js";

// ========= Bootstrap resiliente (raiz OU configs/) =========
let loadBotConfig = () => ({});
try {
  const m = await import("../bootstrap.js");
  loadBotConfig = m.loadBotConfig || m.default?.loadBotConfig || loadBotConfig;
} catch {
  try {
    const m = await import("../configs/bootstrap.js");
    loadBotConfig = m.loadBotConfig || m.default?.loadBotConfig || loadBotConfig;
  } catch {
    console.warn("[bootstrap] ausente; seguindo com defaults");
  }
}

// ========= (opcionais) ASR / TTS / Promo =========
let transcribeAudio = null;
try { const mod = await import("./core/asr.js"); transcribeAudio = mod?.transcribeAudio || mod?.default || null; } catch {}
let ttsSpeak = null;
try { const mod = await import("./core/tts.js"); ttsSpeak = mod?.synthesizeTTS || mod?.speak || mod?.default || null; } catch {}
let promotions = null;
try { const mod = await import("./core/promotions.js"); promotions = mod?.default || mod; } catch {}

// ========= App / ENV =========
if (process.env.NODE_ENV !== "production") { try { await import("dotenv/config"); } catch {} }
const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan(process.env.NODE_ENV === "development" ? "dev" : "combined"));

const envB = (v, d=false)=> (v==null?d:["1","true","yes","y","on"].includes(String(v).trim().toLowerCase()));
const envN = (v,d)=> (Number.isFinite(Number(v))?Number(v):d);

const PORT        = envN(process.env.PORT, 8080);
const HOST        = process.env.HOST || "0.0.0.0";
const OPS_TOKEN   = process.env.OPS_TOKEN || process.env.ADMIN_TOKEN || "";

const ECHO_MODE   = envB(process.env.ECHO_MODE, false);
let INTAKE_ON     = envB(process.env.INTAKE_ENABLED, true);
let SEND_ON       = envB(process.env.SEND_ENABLED, true);
let DIRECT_SEND   = envB(process.env.DIRECT_SEND, true);

const GAP_PER_TO  = envN(process.env.QUEUE_OUTBOX_MIN_GAP_MS, 2500);

// ========= Outbox (Redis) =========
const REDIS_URL    = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || "";
const OUTBOX_TOPIC = process.env.OUTBOX_TOPIC || `outbox:${process.env.WPP_SESSION || "default"}`;
const OUTBOX_CONC  = envN(process.env.QUEUE_OUTBOX_CONCURRENCY, 1);

const outbox = await createOutbox({ topic: OUTBOX_TOPIC, concurrency: OUTBOX_CONC, redisUrl: REDIS_URL });
await outbox.start(async (job) => {
  const { to, kind = "text", payload = {} } = job || {};
  await sendViaAdapter(to, kind, payload);
});

// ========= Flows / Hooks =========
const flows = await loadFlows(BOT_ID);           // carrega flows da pasta da BOT atual
const hooks = await getBotHooks();               // hooks opcionais da BOT
const HOOKS_ON = settings?.flags?.disable_hooks_fallback === false; // gating global de hooks

// ========= Trace leve =========
const TRACE_MAX = 800;
const traceBuf = [];
const trace = (row)=>{ traceBuf.push({ ts: Date.now(), ...row }); if (traceBuf.length>TRACE_MAX) traceBuf.splice(0, traceBuf.length-TRACE_MAX); };

// ========= Anti-rajada / idempotência =========
const sentOpening  = new Set();
const lastSentAt   = new Map();
const processedIds = new Set();

const SAME_REPLY_MS = Number(settings?.flags?.reply_dedupe_ms) || 0;
const lastOut = new Map(); // to -> { text, ts }
const shouldDedupeOut = (to, text)=>{
  if (!SAME_REPLY_MS) return false;
  const cur = lastOut.get(to) || {text:"", ts:0};
  return cur.text === String(text||"") && (Date.now()-cur.ts) < SAME_REPLY_MS;
};
const markOut = (to, text)=> lastOut.set(to, { text:String(text||""), ts:Date.now() });

// ========= Helpers de envio =========
async function sendViaAdapter(to, kind, payload) {
  if (!to || !SEND_ON) return;
  if (kind === "image") {
    const url = payload?.url; const caption = String(payload?.caption || "");
    if (url) await adapter.sendImage(to, url, caption);
    return;
  }
  if (kind === "audio") {
    const buf = payload?.buffer; const mime = payload?.mime || "audio/ogg";
    if (buf && adapter?.sendAudio) { await adapter.sendAudio(to, buf, { mime, ptt:true }); return; }
    const fallback = String(payload?.fallbackText || "");
    if (fallback) await adapter.sendMessage(to, { text: fallback });
    return;
  }
  const text = String(payload?.text || "");
  if (text) {
    if (shouldDedupeOut(to, text)) return;
    await adapter.sendMessage(to, { text });
    markOut(to, text);
  }
}
async function enqueueOrDirect({ to, kind="text", payload={} }) {
  try {
    if (DIRECT_SEND || !outbox.isConnected()) { await sendViaAdapter(to, kind, payload); return "direct"; }
    await outbox.publish({ to, kind, payload }); return "outbox";
  } catch {
    await sendViaAdapter(to, kind, payload); return "direct-fallback";
  }
}

// ========= Sanitização de links =========
function get(obj, path) {
  return String(path||"").split(".").reduce((acc,k)=> (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
}
function expandTpl(str, ctx) {
  return String(str||"").replace(/{{\s*([^}]+)\s*}}/g,(_,p)=> {
    const v = get(ctx, p.trim()); return v==null ? "" : String(v);
  });
}
function allowedLinks() {
  const raw = settings?.guardrails?.allowed_links || [];
  const ctx = { ...settings, product: settings?.product || {} };
  return (Array.isArray(raw)?raw:[])
    .map((u)=> expandTpl(u, ctx))
    .filter((u)=> typeof u==="string" && u.trim().startsWith("http"));
}
function sanitizeLinks(text) {
  const allow = new Set(allowedLinks());
  return String(text||"").replace(/https?:\/\/\S+/gi, (url)=> allow.has(url) ? url : "[link removido]");
}
function stripCodeFences(s="") {
  const t = String(s).trim();
  if (t.startsWith("```")) return t.replace(/^```[a-z0-9]*\s*/i,"").replace(/```$/,"").trim();
  return t;
}
function parseJSONSafe(s) { try { return JSON.parse(stripCodeFences(s)); } catch { return null; } }
function extractReply(out) {
  const parsed = parseJSONSafe(out);
  if (parsed && typeof parsed==="object" && parsed.reply) return String(parsed.reply||"").trim();
  return String(out||"").trim();
}
function prepText(out) { return sanitizeLinks(extractReply(out)); }

// ========= Sessão =========
import { loadSession, saveSession } from "./core/session.js";

// ========= ASR/TTS =========
async function tryTranscribe(raw) {
  try {
    if (!transcribeAudio || !adapter?.getAudioBuffer) return null;
    const buf = await adapter.getAudioBuffer(raw);
    if (!buf) return null;
    const res = await transcribeAudio({
      buffer: buf, mimeType: "audio/ogg",
      provider: settings?.audio?.asrProvider || "openai",
      model: settings?.audio?.asrModel || "whisper-1",
      language: settings?.audio?.language || "pt",
    });
    return (res && res.trim()) ? res.trim() : null;
  } catch { return null; }
}
async function tryTTS(text) {
  if (!text || !ttsSpeak || settings?.flags?.allow_audio_out === false) return null;
  try {
    const out = await ttsSpeak({ text, voice: settings?.audio?.ttsVoice || "alloy", language: settings?.audio?.language || "pt", format: "ogg" });
    if (out?.buffer) return out;
  } catch {}
  return null;
}

// ========= DEBUG BUFFER (para /wpp/debug) =========
const DBG_MAX = 200;
const dbgBuf = [];
function dbgPush(row) {
  const item = { ts: Date.now(), ...row };
  dbgBuf.push(item);
  if (dbgBuf.length > DBG_MAX) dbgBuf.splice(0, dbgBuf.length - DBG_MAX);
  return item;
}
function requireOps(req,res,next){
  const token = req.get("X-Ops-Token") || (req.query?.token ?? "");
  if (!OPS_TOKEN) return res.status(403).json({ ok:false, error:"OPS_TOKEN unset" });
  if (String(token) !== String(OPS_TOKEN)) return res.status(401).json({ ok:false, error:"unauthorized" });
  next();
}

// ========= Flow runner (resiliente) =========
function pickHandle(flowsMod) {
  if (typeof flowsMod?.__handle === "function") return flowsMod.__handle;
  if (typeof flowsMod?.handle   === "function") return flowsMod.handle;
  if (typeof flowsMod?.default?.handle === "function") return flowsMod.default.handle;
  return null;
}
function pickUnit(flowsMod, intent) {
  return flowsMod?.[intent] || flowsMod?.greet || flowsMod?.default || null;
}

// ⚠️ NOVO: suporta pickFlow() do módulo da bot (se existir). Mantém compat com run/handle/fn.
async function runFlows({ from, text, state }) {
  const wantAudio = false;
  let used = "none";
  let reply = "";

  // 0) pickFlow → decide handler dinamicamente (string, função, ou objeto com run)
  if (typeof flows?.pickFlow === "function") {
    try {
      const selected = await flows.pickFlow(text, settings);
      let unit = null;
      if (typeof selected === "string")      unit = flows?.[selected] || flows?.default || null;
      else if (typeof selected === "function") unit = selected;
      else if (selected && typeof selected.run === "function") unit = selected;

      if (unit) {
        if (typeof unit.run === "function") {
          await unit.run({
            jid: from, userId: from, text, settings, state,
            send: async (to, t)=> deliver({ to, text: String(t||""), wantAudio })
          });
          used = `flow/pickFlow.run`;
          return { used, reply: "" };
        }
        if (typeof unit === "function") {
          const out = await unit({
            jid: from, userId: from, text, settings, state,
            send: async (to, t)=> deliver({ to, text: String(t||""), wantAudio })
          });
          reply = out?.reply || (typeof out === "string" ? out : "");
          used = `flow/pickFlow.fn`;
          return { used, reply };
        }
      }
    } catch (e) {
      console.warn("[flow.pickFlow]", e?.message || e);
    }
  }

  // 1) handle/__handle
  const handle = pickHandle(flows);
  if (handle) {
    try {
      const out = await handle({
        jid: from, userId: from, text, settings, state,
        send: async (to, t)=> deliver({ to, text: String(t||""), wantAudio })
      });
      reply = out?.reply || "";
      used = "flow/handle";
      return { used, reply };
    } catch (e) {
      console.warn("[flow.handle]", e?.message || e);
    }
  }

  // 2) intent → obj.run / função default
  const intent = intentOf(text);
  let unit = pickUnit(flows, intent);

  if (unit && typeof unit.run === "function") {
    try {
      await unit.run({
        jid: from, userId: from, text, settings, state,
        send: async (to, t)=> deliver({ to, text: String(t||""), wantAudio })
      });
      used = `flow/${unit.name || intent}`;
      return { used, reply: "" };
    } catch (e) {
      console.warn("[flow.run]", e?.message || e);
    }
  }

  if (typeof unit === "function") {
    try {
      const out = await unit({
        jid: from, userId: from, text, settings, state,
        send: async (to, t)=> deliver({ to, text: String(t||""), wantAudio })
      });
      reply = out?.reply || "";
      used = `flow/${unit.name || intent}`;
      return { used, reply };
    } catch (e) {
      console.warn("[flow(fn)]", e?.message || e);
    }
  }

  return { used, reply };
}

// ========= Entrega unificada =========
async function deliver({ to, text, wantAudio=false }) {
  const clean = prepText(text);
  if (!clean) return;
  if (shouldDedupeOut(to, clean)) return;

  const audio = await tryTTS(clean);
  if (audio?.buffer) {
    await enqueueOrDirect({ to, kind: "audio", payload: { buffer: audio.buffer, mime: audio.mime || "audio/ogg", fallbackText: clean } });
  }
  await enqueueOrDirect({ to, payload: { text: clean } });
  markOut(to, clean);
}

// ========= (NOVO) Roteia uma action do orquestrador → envio/outbox =========
async function routeAction(a, toFallback) {
  if (!a) return;
  const kind = (a.kind || a.type || "text").toLowerCase();
  const to   = String(a.to || toFallback || "").trim();
  if (!to) return;

  if (kind === "image" && a.url) {
    await enqueueOrDirect({ to, kind: "image", payload: { url: a.url, caption: a.caption || "" } });
    return;
  }
  if (kind === "audio" && (a.buffer || a.payload?.buffer)) {
    const buf = a.buffer || a.payload?.buffer;
    const mime = a.mime || a.payload?.mime || "audio/ogg";
    await enqueueOrDirect({ to, kind: "audio", payload: { buffer: buf, mime } });
    return;
  }
  const txt = a.text || a.payload?.text || "";
  if (txt && !shouldDedupeOut(to, txt)) {
    await enqueueOrDirect({ to, kind: "text", payload: { text: prepText(txt) } });
    markOut(to, txt);
  }
}

// ========= Handler principal (onMessage) =========
adapter.onMessage(async ({ from, text, hasMedia, raw }) => {
  if (!INTAKE_ON) return "";

  const state = await loadSession(BOT_ID, from);
  const persist = async ()=> { try { await saveSession(BOT_ID, from, state); } catch {} };

  try {
    const id = (()=>{ try { return raw?.key?.id || ""; } catch { return ""; } })();
    if (id) {
      if (processedIds.has(id)) return "";
      processedIds.add(id); setTimeout(()=> processedIds.delete(id), 180000).unref();
    }

    // === DEBUG CAPTURE (sempre no início)
    try {
      const msgTypes = raw?.message ? Object.keys(raw.message) : [];
      dbgPush({
        kind: "inbound",
        fromMe: !!raw?.key?.fromMe,
        remoteJid: raw?.key?.remoteJid || "",
        participant: raw?.key?.participant || null,
        pushName: raw?.pushName || null,
        hasMedia: !!hasMedia,
        msgTypes,
        preview: String(text || "").slice(0, 120),
      });
    } catch {}

    // mídia de abertura (1x)
    if (!sentOpening.has(from)) {
      try {
        const media = await hooks?.openingMedia?.(settings);
        if (media?.url && settings?.flags?.send_opening_photo !== false) {
          await enqueueOrDirect({ to: from, kind: "image", payload: { url: media.url, caption: media.caption || "" } });
        }
      } catch {}
      sentOpening.add(from);
    }

    // ECHO
    if (ECHO_MODE && text) { 
      await enqueueOrDirect({ to: from, payload: { text: `Echo: ${text}` } }); 
      dbgPush({ kind:"outbound", to: from, preview: `Echo: ${String(text).slice(0,120)}` });
      await persist(); 
      return ""; 
    }

    // texto / ASR
    let msg = String(text || "").trim();
    if (!msg && hasMedia && raw?.message?.audioMessage) {
      const asr = await tryTranscribe(raw);
      if (asr) msg = asr;
    }
    if (!msg) { await persist(); return ""; }

    // cooldown por contato
    const last = lastSentAt.get(from) || 0;
    if (Date.now() - last < GAP_PER_TO) { await persist(); return ""; }

    // 1) FLOW (resiliente) — agora com pickFlow + alias userId
    const flowRes = await runFlows({ from, text: msg, state });
    if (flowRes.reply && flowRes.reply.trim()) {
      await deliver({ to: from, text: flowRes.reply });
      dbgPush({ kind:"outbound", to: from, preview: String(flowRes.reply).slice(0,120), via: flowRes.used });
      lastSentAt.set(from, Date.now());
      trace({ from, text_in: msg, source: flowRes.used, preview: flowRes.reply.slice(0,120) });
      await persist(); return "";
    }

    // 2) ORCHESTRATOR — usa { actions } do core
    const flowOnly = !!settings?.flags?.flow_only;
    if (!flowOnly) {
      try {
        const { actions = [] } = await orchestrate({
          session: state,
          from,
          text: msg,
          meta: { stageHint: intentOf(msg), settings }
        });

        if (Array.isArray(actions) && actions.length) {
          for (const a of actions) await routeAction(a, from);
          dbgPush({ kind:"outbound", to: from, preview: "[actions]", via: "orchestrator[]" });
          lastSentAt.set(from, Date.now()); await persist(); return "";
        }
      } catch (e) { console.warn("[orchestrator]", e?.message || e); }
    }

    // 3) Freeform/HOOKS (somente se ligado)
    if (!flowOnly && HOOKS_ON) {
      try {
        const built = await hooks?.safeBuildPrompt?.({ stage: "qualify", message: msg, settings });
        if (built && (built.system || built.user)) {
          const { text: fb } = await callLLM({ stage: "qualify", system: built.system, prompt: built.user });
          if (fb && String(fb).trim()) {
            await deliver({ to: from, text: fb });
            dbgPush({ kind:"outbound", to: from, preview: String(fb).slice(0,120), via: "hooks/LLM" });
            lastSentAt.set(from, Date.now()); await persist(); return "";
          }
        }
      } catch (e) { console.warn("[freeform]", e?.message || e); }

      const fb = await hooks?.fallbackText?.({ stage: "error", message: msg, settings });
      if (fb && String(fb).trim()) {
        await deliver({ to: from, text: fb });
        dbgPush({ kind:"outbound", to: from, preview: String(fb).slice(0,120), via: "hooks/fallback" });
        lastSentAt.set(from, Date.now()); await persist(); return "";
      }
    }

    // 4) Nudge curto (evita silêncio)
    {
      const haveName = !!(state?.profile?.name);
      const ctx = { profile: state?.profile || {}, product: settings?.product || {} };
      const tpl = haveName
        ? (settings?.messages?.opening_named?.[0] || "")
        : (settings?.messages?.opening?.[0] || "");
      const rendered = tpl ? expandTpl(tpl, ctx) : "";
      const fallback = "Consegue me dizer rapidinho: seu cabelo é liso, ondulado, cacheado ou crespo?";
      const nudge = prepText(rendered || fallback);

      await enqueueOrDirect({ to: from, payload: { text: nudge } });
      dbgPush({ kind:"outbound", to: from, preview: String(nudge).slice(0,120), via: "nudge" });
      lastSentAt.set(from, Date.now()); await persist(); return "";
    }
  } catch (e) {
    console.error("[onMessage]", e);
    return "";
  }
});

// ========= Rotas HTTP =========
const limiter = rateLimit({ windowMs: 60000, max: 60, standardHeaders: true, legacyHeaders: false });

app.get("/health", (_req,res)=> res.json({
  ok:true,
  ready:wppReady(),
  bot:BOT_ID,
  adapter:"baileys",
  env:process.env.NODE_ENV||"production",
  outbox:{ topic: OUTBOX_TOPIC, backend: outbox.backend(), connected: outbox.isConnected() },
  ops:{ intake:INTAKE_ON, send:SEND_ON, direct:DIRECT_SEND },
  metrics:{ queue:getQueueSize(), sink:getSink(), backoffMs:getBackoffMs() }
}));

app.get("/wpp/health", (_req,res)=> res.json({
  ok:true,
  ready:wppReady(),
  session: process.env.WPP_SESSION || "default",
  auth_dir: process.env.WPP_AUTH_DIR || "/app/baileys-auth-v2",
  device: process.env.WPP_DEVICE || "Matrix",
  topic: OUTBOX_TOPIC
}));

app.get("/wpp/qr", async (req,res)=>{
  try{
    const dataURL = await getQrDataURL();
    if (!dataURL) return res.status(204).end();
    const view = String(req.query.view||"");
    if (view === "img") {
      res.setHeader("Content-Type","text/html; charset=utf-8");
      return res.send(`<!doctype html><html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0b12;color:#fff;font-family:system-ui"><img src="${dataURL}" width="320" height="320"/><p style="opacity:.7">Atualize para QR novo se expirar.</p></body></html>`);
    }
    if (view === "png") {
      const b64 = dataURL.split(",")[1]; const buf = Buffer.from(b64,"base64");
      res.setHeader("Content-Type","image/png"); return res.send(buf);
    }
    res.json({ ok:true, qr:dataURL, bot:BOT_ID });
  } catch(e){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});
app.get("/qr", (_req,res)=> res.redirect(302, "/wpp/qr?view=img"));

// === DEBUG endpoints ===
app.get("/wpp/debug", requireOps, (req,res)=>{
  const lim = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
  const data = dbgBuf.slice(-lim).reverse();
  res.json({ ok:true, total: dbgBuf.length, items: data });
});
app.get("/wpp/last", requireOps, (_req,res)=>{
  const last = dbgBuf.length ? dbgBuf[dbgBuf.length - 1] : null;
  res.json({ ok:true, last });
});
app.post("/_ops/clear-debug", requireOps, (_req,res)=>{
  dbgBuf.splice(0, dbgBuf.length);
  res.json({ ok:true, cleared:true });
});

// === OPs utilitários (multi-serviço) ===
app.post("/_ops/force-qr", requireOps, async (_req,res)=>{
  try { const forced = await forceNewQr(); res.json({ ok:true, forced }); }
  catch(e){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});
app.post("/_ops/logout-reset", requireOps, async (_req,res)=>{
  try { await logoutAndReset(); res.json({ ok:true }); }
  catch(e){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});

app.get("/ops/mode", (req,res)=> {
  const set = String(req.query.set||"").toLowerCase();
  if (set==="direct") DIRECT_SEND=true;
  if (set==="outbox") DIRECT_SEND=false;
  res.json({ ok:true, direct:DIRECT_SEND, backend: outbox.backend() });
});
app.get("/ops/status", (_req,res)=> res.json({ ok:true, intake:INTAKE_ON, send:SEND_ON, direct:DIRECT_SEND }));

app.post("/wpp/send", limiter, async (req,res)=>{
  try{
    const { to, text, imageUrl, caption } = req.body || {};
    if (!to || (!text && !imageUrl)) return res.status(400).json({ ok:false, error:"Informe { to, text } ou { to, imageUrl }" });
    if (imageUrl) await enqueueOrDirect({ to, kind:"image", payload:{ url:imageUrl, caption:caption||"" } });
    if (text) {
      const clean = prepText(text);
      if (!shouldDedupeOut(to, clean)) { await enqueueOrDirect({ to, payload:{ text: clean } }); markOut(to, clean); }
      dbgPush({ kind:"outbound", to, preview: clean.slice(0,120), via: "manual-send" });
    }
    res.json({ ok:true });
  } catch(e){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});

app.post("/webhook/payment", async (req,res)=>{
  try{
    const headerToken = req.get("X-Webhook-Token"); const bodyToken = (req.body && req.body.token) || "";
    const tokenOk = (headerToken && headerToken === process.env.WEBHOOK_TOKEN) || (bodyToken === process.env.WEBHOOK_TOKEN);
    if (!tokenOk) return res.status(401).json({ ok:false, error:"invalid token" });
    const { to, status, order_id, delivered_at, buyer } = req.body || {};
    const st = String(status||"").toLowerCase(); const eligible = st==="paid" || st==="delivered";
    if (eligible && to && order_id) {
      try { promotions?.enroll?.({ jid:String(to), order_id:String(order_id), status:st, delivered_at: delivered_at||null, extra:{ buyer: buyer||null } }); } catch {}
      try {
        const fb = await hooks?.onPaymentConfirmed?.({
          jid:String(to), settings,
          send: async (jid, text)=> {
            const clean = prepText(text);
            if (!shouldDedupeOut(jid, clean)) { await enqueueOrDirect({ to: jid, payload:{ text: clean } }); markOut(jid, clean); }
            dbgPush({ kind:"outbound", to: jid, preview: clean.slice(0,120), via: "webhook/payment" });
          }
        });
      } catch {}
    }
    res.json({ ok:true });
  } catch(e){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});

// ========= Boot / Shutdown =========
await wppInit({ onQr: ()=>{} });
const server = app.listen(PORT, HOST, ()=> console.log(`[HTTP] Matrix bot (${BOT_ID}) on http://${HOST}:${PORT}`));

async function shutdown(sig){
  console.log("[shutdown]", sig);
  try { await stopOutboxWorkers(); } catch {}
  try { await flushMetricsNow(); } catch {}
  try { await new Promise(r=>server?.close?.(()=>r())); } catch {}
  try { adapter?.close?.(); } catch {}
  try { outbox?.stop?.(); } catch {}
  setTimeout(()=> process.exit(0), 1200).unref();
}
process.once("SIGINT",  ()=> shutdown("SIGINT"));
process.once("SIGTERM", ()=> shutdown("SIGTERM"));
