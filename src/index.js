// src/index.js — Matrix IA 2.0 (enxuto): HTTP + WPP + Outbox/Direct + ASR + LLM via hooks de bot

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { adapter, isReady as wppReady, getQrDataURL } from './adapters/whatsapp/index.js';
import { createOutbox } from './core/queue.js';

import { BOT_ID, settings } from './core/settings.js';
import { loadFlows } from './core/flow-loader.js';
import { intentOf } from './core/intent.js';
import { callLLM } from './core/llm.js';
import { getBotHooks } from './core/bot-registry.js';

// ➕ (novo) orquestrador
import { orchestrate } from './core/orchestrator.js';

let transcribeAudio = null;
try {
  const asrMod = await import('./core/asr.js');
  transcribeAudio = asrMod?.transcribeAudio || asrMod?.default || null;
} catch {
  console.warn('[ASR] módulo ausente — áudio será ignorado.');
}

if (process.env.NODE_ENV !== 'production') {
  try { await import('dotenv/config'); } catch {}
}

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

const envBool = (v, d = false) =>
  (v == null ? d : ['1', 'true', 'yes', 'y', 'on'].includes(String(v).trim().toLowerCase()));
const envNum = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// === ENV principais ===
const PORT = envNum(process.env.PORT, 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ADAPTER_NAME = String(process.env.WPP_ADAPTER || 'baileys');
const ECHO_MODE = envBool(process.env.ECHO_MODE, false);
let intakeEnabled = envBool(process.env.INTAKE_ENABLED, true);
let sendEnabled = envBool(process.env.SEND_ENABLED, true);
let DIRECT_SEND = envBool(process.env.DIRECT_SEND, true);

// Redis / Outbox
const REDIS_MAIN_URL = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';
const OUTBOX_TOPIC = process.env.OUTBOX_TOPIC || `outbox:${process.env.WPP_SESSION || 'default'}`;
const OUTBOX_CONCURRENCY = envNum(process.env.QUEUE_OUTBOX_CONCURRENCY, 1);

const outbox = await createOutbox({
  topic: OUTBOX_TOPIC,
  concurrency: OUTBOX_CONCURRENCY,
  redisUrl: REDIS_MAIN_URL,
});

// Envio base
async function sendViaAdapter(to, kind, payload) {
  if (!to || !sendEnabled) return;
  if (kind === 'image') {
    const url = payload?.url;
    const caption = (payload?.caption || '').toString();
    if (url) await adapter.sendImage(to, url, caption);
  } else {
    const text = String(payload?.text || '');
    if (text) await adapter.sendMessage(to, text);
  }
}

async function enqueueOrDirect({ to, kind = 'text', payload = {} }) {
  try {
    if (DIRECT_SEND || !outbox.isConnected()) {
      await sendViaAdapter(to, kind, payload);
      return { path: 'direct' };
    }
    await outbox.publish({ to, kind, payload });
    return { path: 'outbox' };
  } catch {
    await sendViaAdapter(to, kind, payload);
    return { path: 'direct-fallback' };
  }
}

// Worker outbox
await outbox.start(async (job) => {
  const { to, kind = 'text', payload = {} } = job || {};
  await sendViaAdapter(to, kind, payload);
});

// Flows e hooks
// IMPORTANTE: guardamos o retorno para roteamento local por flow
const flows = await loadFlows(BOT_ID);
const hooks = await getBotHooks();
const sentOpening = new Set();

// Helpers ASR
async function tryGetAudioBuffer(raw) {
  try {
    if (typeof adapter?.getAudioBuffer === 'function') return await adapter.getAudioBuffer(raw);
    if (typeof adapter?.downloadMedia === 'function') return await adapter.downloadMedia(raw, { audioOnly: true });
    return null;
  } catch (e) {
    console.warn('[ASR] tryGetAudioBuffer:', e?.message || e);
    return null;
  }
}
async function transcribeIfPossible(buf, mime = 'audio/ogg') {
  if (!buf || typeof transcribeAudio !== 'function') return null;
  try {
    return await transcribeAudio({
      buffer: buf,
      mimeType: mime,
      provider: settings?.audio?.asrProvider || 'openai',
      model: settings?.audio?.asrModel || 'whisper-1',
      language: settings?.audio?.language || 'pt',
    });
  } catch (e) {
    console.warn('[ASR] transcribeIfPossible:', e?.message || e);
    return null;
  }
}

// ====================
// Handler principal (PATCH: orquestrador primeiro, 1 resposta)
// ====================
adapter.onMessage(async ({ from, text, hasMedia, raw }) => {
  if (!intakeEnabled) return '';
  try {
    // (0) mídia de abertura via hook (1x por contato)
    if (!sentOpening.has(from)) {
      const media = await hooks.openingMedia({ settings });
      if (media?.url) {
        await enqueueOrDirect({
          to: from,
          kind: 'image',
          payload: { url: media.url, caption: media.caption || '' },
        });
      }
      sentOpening.add(from);
    }

    // (1) echo
    if (ECHO_MODE && text) {
      await enqueueOrDirect({ to: from, payload: { text: `Echo: ${text}` } });
      return '';
    }

    // (2) texto base (ou ASR p/ áudio)
    let msgText = (text || '').trim();
    if (hasMedia && !msgText) {
      const buf = await tryGetAudioBuffer(raw);
      const asr = buf ? await transcribeIfPossible(buf) : null;
      if (asr && asr.trim()) msgText = asr.trim();
    }
    if (!msgText) return '';

    // (3) webhook de pós-venda por palavra-chave
    if (/(\bpaguei\b|\bpagamento\s*feito\b|\bcomprovante\b|\bfinalizei\b)/i.test(msgText)) {
      await hooks.onPaymentConfirmed({
        jid: from,
        settings,
        send: async (to, t) => enqueueOrDirect({ to, payload: { text: t } }),
      });
      return '';
    }

    // (4) Orquestrador LLM (primeiro)
    let reply = '';
    try {
      const intent = intentOf(msgText) || 'qualify';
      reply = await orchestrate({ jid: from, text: msgText, stageHint: intent, botSettings: settings });
    } catch (e) {
      console.warn('[orchestrator] erro:', e?.message || e);
    }

    if (reply && reply.trim()) {
      await enqueueOrDirect({ to: from, payload: { text: reply } });
      return '';
    }

    // (5) Fallback — seus flows determinísticos
    let flowObj = null;
    try { if (typeof flows?.__route === 'function') flowObj = flows.__route(msgText); } catch {}
    if (!flowObj) flowObj = flows?.[intentOf(msgText) || 'greet'];

    if (flowObj?.run) {
      const send = async (to, t) => enqueueOrDirect({ to, payload: { text: String(t || '') } });
      await flowObj.run({ jid: from, text: msgText, settings, send });
      return '';
    }

    // (6) Fallback final LLM "texto solto"
    const { system, user } = await hooks.safeBuildPrompt({ stage: 'qualify', message: msgText, settings });
    const { text: fb } = await callLLM({ stage: 'qualify', system, prompt: user });
    await enqueueOrDirect({ to: from, payload: { text: fb || 'Posso te explicar rapidamente como funciona e o valor?' } });
    return '';
  } catch (e) {
    console.error('[onMessage]', e);
    const fb = await hooks.fallbackText({ stage: 'error', message: text || '', settings });
    await enqueueOrDirect({ to: from, payload: { text: fb } });
    return '';
  }
});

// Rotas HTTP
const limiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Matrix IA 2.0',
    bot: BOT_ID,
    adapter: ADAPTER_NAME,
    ready: wppReady(),
    env: process.env.NODE_ENV || 'production',
    ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND },
  });
});

app.get('/wpp/health', (_req, res) => {
  res.json({
    ok: true,
    ready: wppReady(),
    adapter: ADAPTER_NAME,
    session: process.env.WPP_SESSION || 'default',
    backend: outbox.backend(),
    topic: OUTBOX_TOPIC,
    concurrency: OUTBOX_CONCURRENCY,
    ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND },
    redis: { url: REDIS_MAIN_URL ? 'set' : 'unset', connected: outbox.isConnected() },
  });
});

app.get('/wpp/qr', async (req, res) => {
  try {
    const dataURL = await getQrDataURL();
    if (!dataURL) return res.status(204).end();
    const view = (req.query.view || '').toString();
    if (view === 'img') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(
        `<!doctype html><html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0b12;color:#fff"><img src="${dataURL}" width="320" height="320"/></body></html>`,
      );
    }
    if (view === 'png') {
      const b64 = dataURL.split(',')[1];
      const buf = Buffer.from(b64, 'base64');
      res.setHeader('Content-Type', 'image/png');
      return res.send(buf);
    }
    res.json({ ok: true, qr: dataURL, bot: BOT_ID, adapter: ADAPTER_NAME });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get('/qr', (_req, res) => res.redirect(302, '/wpp/qr?view=img'));

app.get('/ops/mode', (req, res) => {
  const set = (req.query.set || '').toString().toLowerCase();
  if (set === 'direct') DIRECT_SEND = true;
  if (set === 'outbox') DIRECT_SEND = false;
  res.json({ ok: true, direct_send: DIRECT_SEND, backend: outbox.backend() });
});

app.get('/ops/status', (_req, res) =>
  res.json({ ok: true, intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND }),
);

app.post('/wpp/send', limiter, async (req, res) => {
  try {
    const { to, text, imageUrl, caption } = req.body || {};
    if (!to || (!text && !imageUrl)) {
      return res.status(400).json({ ok: false, error: 'Informe { to, text } ou { to, imageUrl }' });
    }
    if (imageUrl) await enqueueOrDirect({ to, kind: 'image', payload: { url: imageUrl, caption: caption || '' } });
    if (text) await enqueueOrDirect({ to, payload: { text } });
    res.json({ ok: true, enqueued: true, path: DIRECT_SEND ? 'direct' : 'outbox' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/webhook/payment', async (req, res) => {
  try {
    const { token, to, status } = req.body || {};
    if (token !== process.env.WEBHOOK_TOKEN) return res.status(401).end();
    if (String(status).toLowerCase() === 'paid' && to) {
      await hooks.onPaymentConfirmed({
        jid: String(to),
        settings,
        send: async (jid, text) => enqueueOrDirect({ to: jid, payload: { text } }),
      });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/inbound', async (req, res) => {
  try {
    const { to, text } = req.body || {};
    const jid = String(to || '').trim();
    const msg = String(text || '').trim();
    if (!jid || !msg) return res.status(400).json({ ok: false, error: 'Informe { to, text }' });
    await enqueueOrDirect({ to: jid, payload: { text: msg } });
    res.json({ ok: true, enqueued: true, path: DIRECT_SEND ? 'direct' : 'outbox' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[HTTP] Matrix bot (${BOT_ID}) on http://${HOST}:${PORT}`);
});

function gracefulClose(signal) {
  console.log(`[shutdown] signal=${signal}`);
  server?.close?.(() => console.log('[http] closed'));
  try { adapter?.close?.(); } catch {}
  try { outbox?.stop?.(); } catch {}
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', () => gracefulClose('SIGINT'));
process.on('SIGTERM', () => gracefulClose('SIGTERM'));
