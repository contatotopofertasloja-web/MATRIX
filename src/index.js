// src/index.js — Matrix IA 2.0 (HTTP + WPP + Outbox/Direct + ASR + TTS + LLM + Proveniência + Confinamento por flow)

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { init as wppInit, adapter, isReady as wppReady, getQrDataURL } from './adapters/whatsapp/index.js';
import { createOutbox } from './core/queue.js';
import { stopOutboxWorkers } from './core/queue/dispatcher.js';

import { BOT_ID, settings } from './core/settings.js';
import { loadFlows } from './core/flow-loader.js';
import { intentOf } from './core/intent.js';
import { callLLM } from './core/llm.js';
import { getBotHooks } from './core/bot-registry.js';
import { orchestrate } from './core/orchestrator.js';

// ===== Bootstrap (resiliente: raiz OU configs/) =====
let loadBotConfig = () => ({});
try {
  const m = await import('../bootstrap.js');
  loadBotConfig = m.loadBotConfig || m.default?.loadBotConfig || loadBotConfig;
} catch {
  try {
    const m = await import('../configs/bootstrap.js');
    loadBotConfig = m.loadBotConfig || m.default?.loadBotConfig || loadBotConfig;
  } catch {
    console.warn('[bootstrap] arquivo não encontrado em ../bootstrap.js nem ../configs/bootstrap.js — seguindo com defaults');
  }
}

// Sessão persistente
import { loadSession, saveSession } from './core/session.js';

// Métricas (best-effort)
import { attachMetricsRoutes } from './core/metrics/receiver.js';
import { flushMetricsNow } from './core/metrics/middleware.js';

// ===== ASR =====
let transcribeAudio = null;
try { const asrMod = await import('./core/asr.js'); transcribeAudio = asrMod?.transcribeAudio || asrMod?.default || null; }
catch { console.warn('[ASR] módulo ausente — áudio será ignorado.'); }

// ===== TTS =====
let ttsSpeak = null;
try { const ttsMod = await import('./core/tts.js'); ttsSpeak = ttsMod?.synthesizeTTS || ttsMod?.speak || ttsMod?.default || null; }
catch { console.warn('[TTS] módulo ausente — respostas por áudio desabilitadas.'); }

// ===== Promoções (opcional) =====
let promotions = null;
try { const pmod = await import('./core/promotions.js'); promotions = pmod?.default || pmod; }
catch { console.warn('[promotions] módulo ausente — endpoints seguirão sem erro.'); }

// ===== App/ENV =====
if (process.env.NODE_ENV !== 'production') { try { await import('dotenv/config'); } catch {} }
const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

const envBool = (v, d=false) => (v==null?d:['1','true','yes','y','on'].includes(String(v).trim().toLowerCase()));
const envNum  = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const PORT           = envNum(process.env.PORT, 8080);
const HOST           = process.env.HOST || '0.0.0.0';
const OPS_TOKEN      = process.env.OPS_TOKEN || process.env.ADMIN_TOKEN || '';
const ECHO_MODE      = envBool(process.env.ECHO_MODE, false);
let intakeEnabled    = envBool(process.env.INTAKE_ENABLED, true);
let sendEnabled      = envBool(process.env.SEND_ENABLED, true);
let DIRECT_SEND      = envBool(process.env.DIRECT_SEND, true);

const MIN_GAP_PER_CONTACT_MS = envNum(process.env.QUEUE_OUTBOX_MIN_GAP_MS, 2500);
const MIN_GAP_GLOBAL_MS      = envNum(process.env.QUEUE_OUTBOX_MIN_GAP_GLOBAL_MS, 800);

// Redis / Outbox
const REDIS_MAIN_URL     = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';
const OUTBOX_TOPIC       = process.env.OUTBOX_TOPIC || `outbox:${process.env.WPP_SESSION || 'default'}`;
const OUTBOX_CONCURRENCY = envNum(process.env.QUEUE_OUTBOX_CONCURRENCY, 1);

const outbox = await createOutbox({ topic: OUTBOX_TOPIC, concurrency: OUTBOX_CONCURRENCY, redisUrl: REDIS_MAIN_URL });
await outbox.start(async (job) => {
  const { to, kind = 'text', payload = {} } = job || {};
  await sendViaAdapter(to, kind, payload);
});

// =================== Flows/Hooks ===================
const flows = await loadFlows(BOT_ID);
const hooks = await getBotHooks();
// >>> Gating global dos hooks
const HOOKS_ON = settings?.flags?.disable_hooks_fallback === false;

// =================== Trace ===================
const TRACE_MAX = 800;
const traceBuf = [];
function pushTrace(entry) { traceBuf.push({ ts: Date.now(), ...entry }); if (traceBuf.length > TRACE_MAX) traceBuf.splice(0, traceBuf.length - TRACE_MAX); }
function tag(text, sourceTag) { const s = String(text || ''); if (!s.trim()) return s; if (/\)\s*$/.test(s) && /\([^)]+?\)\s*$/.test(s)) return s; return `${s} (${sourceTag})`; }

// =================== Anti-rajada / idem ===================
const sentOpening  = new Set();
const lastSentAt   = new Map();
const lastHash     = new Map();
const processedIds = new Set();

const lastOutbound = new Map(); // to -> { text, ts }
const SAME_REPLY_MS = Number(settings?.flags?.reply_dedupe_ms) || 0;
function shouldDedupeOutbound(to, text) {
  if (!SAME_REPLY_MS) return false;
  const cur = lastOutbound.get(to) || { text: '', ts: 0 };
  return cur.text === String(text || '') && (Date.now() - cur.ts) < SAME_REPLY_MS;
}
function markOutbound(to, text) { lastOutbound.set(to, { text: String(text || ''), ts: Date.now() }); }
setInterval(() => { if (processedIds.size > 5000) processedIds.clear(); }, 60_000).unref();

// =================== Envio ===================
async function sendViaAdapter(to, kind, payload) {
  if (!to || !sendEnabled) return;
  if (kind === 'image') {
    const url = payload?.url;
    const caption = (payload?.caption || '').toString();
    if (url) await adapter.sendImage(to, url, caption);
    return;
  }
  if (kind === 'audio') {
    const buf = payload?.buffer;
    const mime = payload?.mime || 'audio/ogg';
    if (buf && typeof adapter?.sendAudio === 'function') { await adapter.sendAudio(to, buf, { mime, ptt: true }); return; }
    if (buf && typeof adapter?.sendVoice === 'function') { await adapter.sendVoice(to, buf, { mime }); return; }
    const fallbackText = (payload?.fallbackText || '').toString();
    if (fallbackText) await adapter.sendMessage(to, { text: fallbackText });
    return;
  }
  const text = String(payload?.text || '');
  if (text) {
    if (shouldDedupeOutbound(to, text)) return;
    await adapter.sendMessage(to, { text });
    markOutbound(to, text);
  }
}

async function enqueueOrDirect({ to, kind = 'text', payload = {} }) {
  try {
    if (DIRECT_SEND || !outbox.isConnected()) { await sendViaAdapter(to, kind, payload); return { path: 'direct' }; }
    await outbox.publish({ to, kind, payload }); return { path: 'outbox' };
  } catch { await sendViaAdapter(to, kind, payload); return { path: 'direct-fallback' }; }
}

// =================== Sanitização de links ===================
function get(obj, path) { return String(path || '').split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj); }
function expandTemplates(str, ctx) { return String(str || '').replace(/{{\s*([^}]+)\s*}}/g, (_, p) => { const v = get(ctx, p.trim()); return v == null ? '' : String(v); }); }
function allowedLinksFromSettings() {
  const raw = settings?.guardrails?.allowed_links || [];
  const ctx = { ...settings, product: settings?.product || {}, sweepstakes: settings?.sweepstakes || {} };
  return (Array.isArray(raw) ? raw : []).map((u) => expandTemplates(u, ctx)).filter((u) => typeof u === 'string' && u.trim().startsWith('http'));
}
function sanitizeLinks(text) {
  const allow = new Set(allowedLinksFromSettings());
  return String(text || '').replace(/https?:\/\/\S+/gi, (url) => (allow.has(url) ? url : '[link removido]'));
}
function stripCodeFences(s='') { const t = String(s).trim(); if (t.startsWith('```')) return t.replace(/^```[a-zA-Z0-9]*\s*/,'').replace(/```$/,'').trim(); return t; }
function parseJSONSafe(s) { try { return JSON.parse(stripCodeFences(s)); } catch { return null; } }
function extractReplyAndMeta(outText) {
  const parsed = parseJSONSafe(outText);
  if (parsed && typeof parsed === 'object' && parsed.reply) {
    return { reply: String(parsed.reply || '').trim(), stage: parsed.stage || '', slots: parsed.slots || {}, tool_calls: parsed.tool_calls || [], raw: parsed };
  }
  return { reply: String(outText || '').trim(), stage: '', slots: {}, tool_calls: [], raw: null };
}
function prepareOutboundText(llmOut) { const { reply } = extractReplyAndMeta(llmOut); return sanitizeLinks(reply); }

const hash = (s) => { let h = 0; const str = String(s || ''); for (let i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i)) | 0; return h; };
const getMsgId = (raw) => { try { return raw?.key?.id || raw?.message?.key?.id || ''; } catch { return ''; } };

async function deliverReply({ to, text, wantAudio = false }) {
  const cleanText = prepareOutboundText(text);
  if (!cleanText) return;
  if (shouldDedupeOutbound(to, cleanText)) return;
  if (wantAudio && settings?.flags?.allow_audio_out !== false && typeof ttsSpeak === 'function') {
    try {
      const out = await ttsSpeak({ text: cleanText, voice: settings?.audio?.ttsVoice || 'alloy', language: settings?.audio?.language || 'pt', format: 'ogg' });
      if (out?.buffer) await enqueueOrDirect({ to, kind: 'audio', payload: { buffer: out.buffer, mime: out.mime || 'audio/ogg', fallbackText: cleanText } });
    } catch (e) { console.warn('[TTS] synth fail:', e?.message || e); }
  }
  await enqueueOrDirect({ to, payload: { text: cleanText } });
  markOutbound(to, cleanText);
}

async function sendActions(to, actions = []) {
  if (!Array.isArray(actions) || !actions.length) return false;
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    if (a.kind === 'image' && a.url) {
      await enqueueOrDirect({ to, kind: 'image', payload: { url: a.url, caption: a.caption || '' } });
    } else if (a.kind === 'audio' && a.buffer) {
      await enqueueOrDirect({ to, kind: 'audio', payload: { buffer: a.buffer, mime: a.mime || 'audio/ogg' } });
    } else if (a.kind === 'text' && a.text) {
      const t = prepareOutboundText(a.text);
      if (!shouldDedupeOutbound(to, t)) { await enqueueOrDirect({ to, payload: { text: t } }); markOutbound(to, t); }
    }
  }
  return true;
}

// =================== Handler principal ===================
adapter.onMessage(async ({ from, text, hasMedia, raw }) => {
  if (!intakeEnabled) return '';
  const state = await loadSession(BOT_ID, from);
  const persist = async () => { try { await saveSession(BOT_ID, from, state); } catch {} };

  try {
    const now = Date.now();

    // Idempotência inbound
    const mid = getMsgId(raw);
    if (mid) {
      if (processedIds.has(mid)) { await persist(); return ''; }
      processedIds.add(mid); setTimeout(() => processedIds.delete(mid), 3 * 60_000).unref();
    } else {
      const h = `${from}:${hash(text)}`;
      if (lastHash.get(from) === h && (now - (lastSentAt.get(from) || 0)) < 3000) { await persist(); return ''; }
      lastHash.set(from, h);
    }

    // mídia de abertura (1x)
    if (!sentOpening.has(from)) {
      const media = await hooks.openingMedia?.({ settings });
      if (media?.url && settings?.flags?.send_opening_photo !== false) {
        await enqueueOrDirect({ to: from, kind: 'image', payload: { url: media.url, caption: media.caption || '' } });
      }
      sentOpening.add(from);
    }

    // Echo
    if (ECHO_MODE && text) {
      const stamped = tag(`Echo: ${text}`, 'echo');
      await enqueueOrDirect({ to: from, payload: { text: stamped } });
      lastSentAt.set(from, now);
      pushTrace({ from, text_in: text, source: 'echo', preview: stamped.slice(0,120), intent: 'echo', stage: 'echo', path: 'direct' });
      await persist(); return '';
    }

    // Texto (ou ASR)
    let msgText = (text || '').trim();
    const incomingIsAudio = !!raw?.message?.audioMessage;
    if (hasMedia && !msgText && incomingIsAudio) {
      try {
        const buf = await (typeof adapter?.getAudioBuffer === 'function' ? adapter.getAudioBuffer(raw) : null);
        if (buf && typeof transcribeAudio === 'function') {
          const asr = await transcribeAudio({ buffer: buf, mimeType: 'audio/ogg', provider: settings?.audio?.asrProvider || 'openai', model: settings?.audio?.asrModel || 'whisper-1', language: settings?.audio?.language || 'pt' });
          if (asr && asr.trim()) msgText = asr.trim();
        }
      } catch (e) { console.warn('[ASR] erro:', e?.message || e); }
    }
    if (!msgText) { await persist(); return ''; }

    // Cooldown por contato
    const last = lastSentAt.get(from) || 0;
    if (now - last < MIN_GAP_PER_CONTACT_MS) { await persist(); return ''; }

    // ====== FLOW RUNNER (resiliente) ======
    const flowOnly  = !!settings?.flags?.flow_only;
    const wantAudio = incomingIsAudio;
    const userIntent = intentOf(msgText);

    let used = 'unknown';
    let reply = '';

    // (A) Tenta handle global (várias exposições possíveis)
    let handleFn = null;
    try { handleFn = flows?.__handle || flows?.handle || flows?.default?.handle || null; } catch {}
    if (typeof handleFn === 'function') {
      try {
        const out = await handleFn({ jid: from, text: msgText, settings, state, send: (to, t) => deliverReply({ to, text: t, wantAudio }) });
        reply = out?.reply || '';
        used = 'flow/index';
      } catch (e) {
        console.warn('[flow.handle] erro:', e?.message || e);
      }
    } else {
      // (B) Sem handle: tenta uma função default do flow (e.g., greet.js export default function)
      let flowFn = null;
      // roteamento leve opcional do loader
      try { if (typeof flows?.__route === 'function') flowFn = flows.__route(msgText, settings, from); } catch {}
      // fallback por intenção
      if (!flowFn) flowFn = flows?.[userIntent] || flows?.greet || flows?.default;

      // suporta tanto objeto com .run quanto função direta
      if (flowFn && typeof flowFn.run === 'function') {
        try {
          await flowFn.run({ jid: from, text: msgText, settings, state, send: (to, t) => deliverReply({ to, text: String(t || ''), wantAudio }) });
          used = `flow/${flowFn?.name || userIntent}`;
        } catch (e) {
          console.warn('[flow.run] erro:', e?.message || e);
        }
      } else if (typeof flowFn === 'function') {
        try {
          const out = await flowFn({ jid: from, text: msgText, settings, state, send: (to, t) => deliverReply({ to, text: String(t || ''), wantAudio }) });
          reply = out?.reply || ''; // se a função retornar objeto {reply}
          used = `flow/${flowFn.name || userIntent}`;
        } catch (e) {
          console.warn('[flow(fn)] erro:', e?.message || e);
        }
      }
    }

    // (C) Se o flow devolveu reply direta
    if (reply && reply.trim()) {
      const stamped = settings?.flags?.debug_trace_replies ? tag(prepareOutboundText(reply), used.startsWith('flow') ? used.replace('flow','flow') : 'flow') : prepareOutboundText(reply);
      await deliverReply({ to: from, text: stamped, wantAudio });
      lastSentAt.set(from, Date.now());
      pushTrace({ from, text_in: msgText, source: used, preview: stamped.slice(0,120), intent: userIntent, stage: userIntent, path: DIRECT_SEND ? 'direct' : 'outbox' });
      await persist(); return '';
    }

    // ====== ORCHESTRATOR (quando não confinado) ======
    if (!flowOnly) {
      try {
        const out = await orchestrate({ jid: from, text: msgText, stageHint: userIntent, botSettings: settings });
        if (Array.isArray(out) && out.length) {
          await sendActions(from, out);
          lastSentAt.set(from, Date.now());
          pushTrace({ from, text_in: msgText, source: 'llm/orchestrator', preview: JSON.stringify(out).slice(0,120), intent: userIntent, stage: userIntent, path: DIRECT_SEND ? 'direct' : 'outbox' });
          await persist(); return '';
        }
        if (out && String(out).trim()) {
          const stamped = settings?.flags?.debug_trace_replies ? tag(prepareOutboundText(out), 'llm/orchestrator') : prepareOutboundText(out);
          await deliverReply({ to: from, text: stamped, wantAudio });
          lastSentAt.set(from, Date.now());
          pushTrace({ from, text_in: msgText, source: 'llm/orchestrator', preview: stamped.slice(0,120), intent: userIntent, stage: userIntent, path: DIRECT_SEND ? 'direct' : 'outbox' });
          await persist(); return '';
        }
      } catch (e) { console.warn('[orchestrator] erro:', e?.message || e); }
    }

    // ====== FREEFORM / HOOKS — só se ligado ======
    if (!flowOnly && HOOKS_ON) {
      try {
        const built = await hooks.safeBuildPrompt?.({ stage: 'qualify', message: msgText, settings });
        if (built && (built.system || built.user)) {
          const { text: fb } = await callLLM({ stage: 'qualify', system: built.system, prompt: built.user });
          if (fb && String(fb).trim()) {
            const stamped = settings?.flags?.debug_trace_replies ? tag(prepareOutboundText(fb), 'llm/freeform') : prepareOutboundText(fb);
            await deliverReply({ to: from, text: stamped, wantAudio });
            lastSentAt.set(from, Date.now());
            pushTrace({ from, text_in: msgText, source: 'llm/freeform', preview: stamped.slice(0,120), intent: userIntent, stage: 'qualificacao', path: DIRECT_SEND ? 'direct' : 'outbox' });
            await persist(); return '';
          }
        }
      } catch (e) { console.warn('[freeform] erro:', e?.message || e); }

      const fb = await hooks.fallbackText?.({ stage: 'error', message: msgText, settings });
      const textToSend = (fb && String(fb).trim()) ? prepareOutboundText(fb) : '';
      if (textToSend) {
        const stamped = settings?.flags?.debug_trace_replies ? tag(textToSend, 'hooks') : textToSend;
        if (!shouldDedupeOutbound(from, stamped)) { await enqueueOrDirect({ to: from, payload: { text: stamped } }); markOutbound(from, stamped); }
        lastSentAt.set(from, Date.now());
        pushTrace({ from, text_in: msgText, source: 'hooks', preview: stamped.slice(0,120), intent: userIntent, stage: 'error', path: DIRECT_SEND ? 'direct' : 'outbox' });
        await persist(); return '';
      }
    }

    // Silêncio
    await persist(); return '';
  } catch (e) {
    console.error('[onMessage]', e);
    try {
      if (!settings?.flags?.flow_only && HOOKS_ON) {
        const fb = await hooks.fallbackText?.({ stage: 'error', message: text || '', settings });
        const txt = (fb && String(fb).trim()) ? prepareOutboundText(fb) : '';
        if (txt && !shouldDedupeOutbound(from, txt)) { await enqueueOrDirect({ to: from, payload: { text: txt } }); markOutbound(from, txt); }
      }
    } catch {}
    return '';
  }
});

// =================== Rotas HTTP ===================
const limiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
function requireOpsAuth(req, res, next) {
  const token = req.get('X-Ops-Token') || (req.query?.token ?? '');
  if (!OPS_TOKEN) return res.status(403).json({ ok: false, error: 'OPS_TOKEN unset' });
  if (String(token) !== String(OPS_TOKEN)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}

app.get('/health', (_req, res) => { res.json({ ok: true, service: 'Matrix IA 2.0', bot: BOT_ID, ready: wppReady(), env: process.env.NODE_ENV || 'production', ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND } }); });
app.get('/wpp/health', (_req, res) => { res.json({ ok: true, ready: wppReady(), session: process.env.WPP_SESSION || 'default', backend: outbox.backend(), topic: OUTBOX_TOPIC, concurrency: OUTBOX_CONCURRENCY, ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND }, redis: { url: REDIS_MAIN_URL ? 'set' : 'unset', connected: outbox.isConnected() } }); });

// QR
app.get('/wpp/qr', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); res.setHeader('Pragma', 'no-cache'); res.setHeader('Expires', '0'); res.setHeader('Surrogate-Control', 'no-store');
    const force = String(req.query.force || '') === '1';
    if (force) { const wpp = await import('./adapters/whatsapp/index.js'); if (wpp.forceNewQr) await wpp.forceNewQr(); }
    const dataURL = await getQrDataURL(); if (!dataURL) return res.status(204).end();
    const view = (req.query.view || '').toString();
    if (view === 'img') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.send(`<!doctype html><html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0b12;color:#fff"><img src="${dataURL}" width="320" height="320"/></body></html>`); }
    if (view === 'png') { const b64 = dataURL.split(',')[1]; const buf = Buffer.from(b64, 'base64'); res.setHeader('Content-Type', 'image/png'); return res.send(buf); }
    res.json({ ok: true, qr: dataURL, bot: BOT_ID });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
app.get('/qr', (_req, res) => res.redirect(302, '/wpp/qr?view=img'));

// Logout
app.post('/wpp/logout', async (_req, res) => {
  try { const wpp = await import('./adapters/whatsapp/index.js'); if (wpp?.logoutAndReset) await wpp.logoutAndReset(); res.json({ ok: true, reset: true }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// Ops
app.get('/ops/mode', (req, res) => { const set = (req.query.set || '').toString().toLowerCase(); if (set === 'direct') DIRECT_SEND = true; if (set === 'outbox') DIRECT_SEND = false; res.json({ ok: true, direct_send: DIRECT_SEND, backend: outbox.backend() }); });
app.get('/ops/status', (_req, res) => { res.json({ ok: true, intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND }); });

// Envio manual
app.post('/wpp/send', limiter, async (req, res) => {
  try {
    const { to, text, imageUrl, caption } = req.body || {};
    if (!to || (!text && !imageUrl)) return res.status(400).json({ ok: false, error: 'Informe { to, text } ou { to, imageUrl }' });
    if (imageUrl) await enqueueOrDirect({ to, kind: 'image', payload: { url: imageUrl, caption: caption || '' } });
    if (text) {
      const clean = prepareOutboundText(text);
      if (!shouldDedupeOutbound(to, clean)) { await enqueueOrDirect({ to, payload: { text: clean } }); markOutbound(to, clean); }
    }
    res.json({ ok: true, enqueued: true, path: DIRECT_SEND ? 'direct' : 'outbox' });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// Webhook pagamento
app.post('/webhook/payment', async (req, res) => {
  try {
    const headerToken = req.get('X-Webhook-Token');
    const bodyToken = (req.body && req.body.token) || '';
    const tokenOk = (headerToken && headerToken === process.env.WEBHOOK_TOKEN) || (bodyToken === process.env.WEBHOOK_TOKEN);
    if (!tokenOk) return res.status(401).json({ ok: false, error: 'invalid token' });

    const { to, status, order_id, delivered_at, buyer } = req.body || {};
    const normalizedStatus = String(status || '').toLowerCase();
    const eligible = normalizedStatus === 'paid' || normalizedStatus === 'delivered';

    if (eligible && to && order_id) {
      if (promotions && typeof promotions.enroll === 'function') promotions.enroll({ jid: String(to), order_id: String(order_id), status: normalizedStatus, delivered_at: delivered_at || null, extra: { buyer: buyer || null } });
      await hooks.onPaymentConfirmed?.({
        jid: String(to),
        settings,
        send: async (jid, text) => {
          const clean = prepareOutboundText(text);
          if (!shouldDedupeOutbound(jid, clean)) { await enqueueOrDirect({ to: jid, payload: { text: clean } }); markOutbound(jid, clean); }
        },
      });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// Debug
app.get('/debug/last', requireOpsAuth, (req, res) => { const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 50))); const from = (req.query?.from || '').toString(); const rows = traceBuf.filter(r => !from || r.from === from).slice(-limit).reverse(); res.json({ ok: true, count: rows.length, rows }); });
app.get('/debug/metrics', requireOpsAuth, (_req, res) => { const counts = traceBuf.reduce((acc, r) => { acc[r.source] = (acc[r.source] || 0) + 1; return acc; }, {}); res.json({ ok: true, sources: counts, total: traceBuf.length }); });

// Boot
await wppInit({ onQr: () => {} });
const server = app.listen(PORT, HOST, () => { console.log(`[HTTP] Matrix bot (${BOT_ID}) on http://${HOST}:${PORT}`); });

// Shutdown
async function gracefulClose(signal) {
  console.log(`[shutdown] signal=${signal}`);
  try { await stopOutboxWorkers(); } catch (e) { console.warn('[shutdown] stopOutboxWorkers:', e?.message || e); }
  try { await flushMetricsNow(); } catch (e) { console.warn('[shutdown] flushMetricsNow:', e?.message || e); }
  try { await new Promise((resolve) => server?.close?.(() => resolve())); console.log('[http] closed'); } catch {}
  try { adapter?.close?.(); } catch {}
  try { outbox?.stop?.(); } catch {}
  setTimeout(() => process.exit(0), 1500).unref();
}
process.once('SIGINT',  () => { gracefulClose('SIGINT');  });
process.once('SIGTERM', () => { gracefulClose('SIGTERM'); });
