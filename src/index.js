// src/index.js — Cláudia (WhatsApp) — HTTP + WPP + Outbox (Redis) + ASR + LLM
// Hotfix v2: prompt/LLM failover (sem "travadinha"), mantendo DIRECT_SEND/outbox.

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
import { buildPrompt } from '../configs/bots/claudia/prompts/index.js';

let transcribeAudio = null;
try { const asrMod = await import('./core/asr.js'); transcribeAudio = asrMod?.transcribeAudio || asrMod?.default || null; }
catch { console.warn('[ASR] módulo ausente — áudio será ignorado.'); }

if (process.env.NODE_ENV !== 'production') { try { await import('dotenv/config'); } catch {} }

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

const envBool = (v, d=false) => (v==null?d:['1','true','yes','y','on'].includes(String(v).trim().toLowerCase()));
const envNum  = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;

// === ENV principais ===
const PORT          = envNum(process.env.PORT, 8080);
const HOST          = process.env.HOST || '0.0.0.0';
const ADAPTER_NAME  = String(process.env.WPP_ADAPTER || 'baileys');
const ECHO_MODE     = envBool(process.env.ECHO_MODE, false);
let   intakeEnabled = envBool(process.env.INTAKE_ENABLED, true);
let   sendEnabled   = envBool(process.env.SEND_ENABLED,   true);
let   DIRECT_SEND   = envBool(process.env.DIRECT_SEND, true); // fica true pro estável

// Redis / Outbox
const REDIS_MAIN_URL     = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';
const OUTBOX_TOPIC       = process.env.OUTBOX_TOPIC || `outbox:${process.env.WPP_SESSION || 'default'}`;
const OUTBOX_CONCURRENCY = envNum(process.env.QUEUE_OUTBOX_CONCURRENCY, 1);

const outbox = await createOutbox({ topic: OUTBOX_TOPIC, concurrency: OUTBOX_CONCURRENCY, redisUrl: REDIS_MAIN_URL });

// Envio direto
async function sendViaAdapter(to, kind, payload) {
  if (!to || !sendEnabled) return;
  if (kind === 'image') {
    const { url, caption = '' } = payload || {};
    if (url) await adapter.sendImage(to, url, caption);
  } else {
    const text = String(payload?.text || '');
    if (text) await adapter.sendMessage(to, text);
  }
}

// Decide fila x direto
async function enqueueOrDirect({ to, kind='text', payload={} }) {
  try {
    if (DIRECT_SEND || !outbox.isConnected()) {
      console.log('[send][direct]', { to, kind });
      await sendViaAdapter(to, kind, payload);
      return { path: 'direct' };
    }
    await outbox.publish({ to, kind, payload });
    console.log('[send][outbox]', { to, kind, topic: OUTBOX_TOPIC });
    return { path: 'outbox' };
  } catch (e) {
    console.warn('[send][fallback->direct]', e?.message || e);
    await sendViaAdapter(to, kind, payload);
    return { path: 'direct-fallback' };
  }
}

// Worker da fila
await outbox.start(async (job) => {
  const { to, kind='text', payload={} } = job || {};
  await sendViaAdapter(to, kind, payload);
});

// Flows
await loadFlows(BOT_ID);
const sentOpening = new Set();

// ====== PROMPT FAILOVER =======================================================
function safeBuildPrompt({ stage, message }) {
  try {
    const p = buildPrompt({ stage, message });
    if (p && (p.system || p.user)) return p;
    throw new Error('buildPrompt retornou vazio');
  } catch (e) {
    console.error('[prompt][fallback]', e?.message || e);
    const price    = settings?.product?.price_target || process.env.PRICE_TARGET || 170;
    const checkout = settings?.product?.checkout_link || process.env.CHECKOUT_LINK || '';
    const system = [
      'Você é a Cláudia, vendedora educada e objetiva. Responda em PT-BR, frases curtas.',
      'Produto ÚNICO. Nunca invente produtos, preços ou links.',
      `Preço promocional: R$${price}. Link seguro: ${checkout || 'link indisponível no momento'}.`,
      'Se perguntarem preço → diga R$${price} e ofereça o link.',
      'Se perguntarem uso → explique passo a passo em 2-3 linhas.',
      'Se houver objeção → responda com segurança (sem prometer o que não temos).',
    ].join(' ');
    const user = String(message || '');
    return { system, user };
  }
}

// ====== FAILOVER DE RESPOSTA COMERCIAL =======================================
function salesFallbackText() {
  const price    = settings?.product?.price_target || process.env.PRICE_TARGET || 170;
  const checkout = settings?.product?.checkout_link || process.env.CHECKOUT_LINK || '';
  return `Promo: R$${price} na entrega. Posso te mandar o link do checkout${checkout ? ` (${checkout})` : ''}?`;
}

// ====== ASR helpers ==========================================================
async function tryGetAudioBuffer(raw) {
  try {
    if (typeof adapter?.getAudioBuffer === 'function') return await adapter.getAudioBuffer(raw);
    if (typeof adapter?.downloadMedia === 'function') return await adapter.downloadMedia(raw, { audioOnly: true });
    return null;
  } catch (e) { console.warn('[ASR] tryGetAudioBuffer:', e?.message || e); return null; }
}
async function transcribeIfPossible(buf, mime='audio/ogg') {
  if (!buf || typeof transcribeAudio !== 'function') return null;
  try {
    return await transcribeAudio({
      buffer: buf, mimeType: mime,
      provider: settings?.audio?.asrProvider || 'openai',
      model:    settings?.audio?.asrModel    || 'whisper-1',
      language: settings?.audio?.language    || 'pt',
    });
  } catch (e) { console.warn('[ASR] transcribeIfPossible:', e?.message || e); return null; }
}

// ====== Handler principal =====================================================
adapter.onMessage(async ({ from, text, hasMedia, raw }) => {
  if (!intakeEnabled) return '';
  try {
    if (settings.flags?.send_opening_photo && !sentOpening.has(from) && settings.media?.opening_photo_url) {
      await enqueueOrDirect({ to: from, kind: 'image', payload: { url: settings.media.opening_photo_url, caption: '' } });
      sentOpening.add(from);
    }

    if (ECHO_MODE && text) {
      await enqueueOrDirect({ to: from, payload: { text: `Echo: ${text}` } });
      return '';
    }

    let msgText = (text || '').trim();
    if (hasMedia && !msgText) {
      const buf = await tryGetAudioBuffer(raw);
      const asr = buf ? await transcribeIfPossible(buf) : null;
      if (asr && asr.trim()) msgText = asr.trim();
    }
    if (!msgText) return '';

    if (/(\bpaguei\b|\bpagamento\s*feito\b|\bcomprovante\b|\bfinalizei\b)/i.test(msgText)) {
      await handlePaymentConfirmed(from);
      return '';
    }

    const intent = intentOf(msgText) || 'greet';
    const { system, user } = safeBuildPrompt({ stage: intent, message: msgText });

    try {
      const { text: reply } = await callLLM({ stage: intent, system, prompt: user });
      if (reply && reply.trim()) {
        await enqueueOrDirect({ to: from, payload: { text: reply } });
        return '';
      }
      // vazio → fallback comercial
      await enqueueOrDirect({ to: from, payload: { text: salesFallbackText() } });
      return '';
    } catch (e) {
      console.error('[LLM][error]', e?.message || e);
      await enqueueOrDirect({ to: from, payload: { text: salesFallbackText() } });
      return '';
    }
  } catch (e) {
    console.error('[onMessage][error]', e);
    await enqueueOrDirect({ to: from, payload: { text: salesFallbackText() } });
    return '';
  }
});

// ====== Pós-venda após pagamento =============================================
async function handlePaymentConfirmed(jid) {
  try {
    for (const line of settings.messages?.postsale_pre_coupon ?? []) {
      await enqueueOrDirect({ to: jid, kind: 'text', payload: { text: line } });
    }
    if (settings.product?.coupon_post_payment_only && settings.product?.coupon_code) {
      const tpl = settings.messages?.postsale_after_payment_with_coupon?.[0] || '';
      const txt = tpl.replace('{{coupon_code}}', settings.product.coupon_code);
      if (txt) await enqueueOrDirect({ to: jid, kind: 'text', payload: { text: txt } });
    }
  } catch (e) { console.error('[payment][confirm][error]', e); }
}

// ====== Rotas HTTP ============================================================
const sendLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'Matrix IA 2.0', bot: BOT_ID, adapter: ADAPTER_NAME, ready: wppReady(),
    env: process.env.NODE_ENV || 'production', ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND } });
});

app.get('/wpp/health', (_req, res) => {
  res.json({ ok: true, ready: wppReady(), adapter: ADAPTER_NAME, session: process.env.WPP_SESSION || 'default',
    backend: outbox.backend(), topic: OUTBOX_TOPIC, concurrency: OUTBOX_CONCURRENCY,
    ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND },
    redis: { url: REDIS_MAIN_URL ? 'set' : 'unset', connected: outbox.isConnected() } });
});

app.get('/wpp/qr', async (req, res) => {
  try {
    const dataURL = await getQrDataURL();
    if (!dataURL) return res.status(204).end();
    const view = (req.query.view || '').toString();
    if (view === 'img') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`<!doctype html><html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0b12;color:#fff"><img src="${dataURL}" width="320" height="320"/></body></html>`);
    }
    if (view === 'png') { const b64 = dataURL.split(',')[1]; const buf = Buffer.from(b64, 'base64'); res.setHeader('Content-Type', 'image/png'); return res.send(buf); }
    res.json({ ok: true, qr: dataURL, bot: BOT_ID, adapter: ADAPTER_NAME });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.get('/qr', (_req, res) => res.redirect(302, '/wpp/qr?view=img'));

app.get('/ops/mode', (req, res) => {
  const set = (req.query.set || '').toString().toLowerCase();
  if (set === 'direct') DIRECT_SEND = true;
  if (set === 'outbox') DIRECT_SEND = false;
  res.json({ ok: true, direct_send: DIRECT_SEND, backend: outbox.backend() });
});

app.get('/ops/status', (_req, res) => res.json({ ok: true, intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND }));

app.post('/wpp/send', sendLimiter, async (req, res) => {
  try {
    const { to, text, imageUrl, caption } = req.body || {};
    if (!to || (!text && !imageUrl)) return res.status(400).json({ ok: false, error: 'Informe { to, text } ou { to, imageUrl }' });
    if (imageUrl) await enqueueOrDirect({ to, kind: 'image', payload: { url: imageUrl, caption: caption || '' } });
    if (text)     await enqueueOrDirect({ to, payload: { text } });
    res.json({ ok: true, enqueued: true, path: DIRECT_SEND ? 'direct' : 'outbox' });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.post('/webhook/payment', async (req, res) => {
  try {
    const { token, to, status } = req.body || {};
    if (token !== process.env.WEBHOOK_TOKEN) return res.status(401).end();
    if (String(status).toLowerCase() === 'paid' && to) await handlePaymentConfirmed(String(to));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.post('/inbound', async (req, res) => {
  try {
    const { to, text } = req.body || {};
    const jid = String(to || '').trim(); const msg = String(text || '').trim();
    if (!jid || !msg) return res.status(400).json({ ok: false, error: 'Informe { to, text }' });
    await enqueueOrDirect({ to: jid, payload: { text: msg } });
    res.json({ ok: true, enqueued: true, path: DIRECT_SEND ? 'direct' : 'outbox' });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[HTTP] Cláudia on http://${HOST}:${PORT}`);
});

function gracefulClose(signal) {
  console.log(`[shutdown] signal=${signal}`);
  server?.close?.(() => console.log('[http] closed'));
  try { adapter?.close?.(); } catch {}
  try { outbox?.stop?.(); } catch {}
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT',  () => gracefulClose('SIGINT'));
process.on('SIGTERM', () => gracefulClose('SIGTERM'));
