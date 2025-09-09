// src/index.js — Cláudia (WhatsApp único) — HTTP + WPP + Outbox (Redis) + Flows + ASR opcional
// Sem contingência. Matrix não pareia aqui.
// Rotas: /health, /wpp/health, /wpp/qr(|?view=img|png), /qr, /ops/status, /wpp/send, /inbound, /webhook/payment

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import Redis from 'ioredis';

// Adapter WhatsApp (único)
import { adapter, isReady as wppReady, getQrDataURL } from './adapters/whatsapp/index.js';

// Fila de envio
import { createOutbox } from './core/queue.js';

// Flows/LLM/settings
import { BOT_ID, settings } from './core/settings.js';
import { loadFlows } from './core/flow-loader.js';
import { intentOf } from './core/intent.js';
import { callLLM } from './core/llm.js';
import { buildPrompt } from '../configs/bots/claudia/prompts/index.js';

// Opcional: transcrição (Whisper). Se faltar, só ignora áudio.
let transcribeAudio = null;
try {
  const asrMod = await import('./core/asr.js');
  transcribeAudio = asrMod?.transcribeAudio || asrMod?.default || null;
} catch {
  console.warn('[ASR] módulo ausente — áudio será ignorado.');
}

// .env em dev
if (process.env.NODE_ENV !== 'production') {
  try { await import('dotenv/config'); } catch {}
}

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

// Helpers ENV
const envBool = (v, d=false) => {
  if (v === undefined || v === null) return d;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'y' || s === 'yes' || s === 'on';
};
const envNum = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;

// ==== Configs principais (sem contingência) ==================================
const PORT          = envNum(process.env.PORT, 8080);
const HOST          = process.env.HOST || '0.0.0.0';
const ADAPTER_NAME  = String(process.env.WPP_ADAPTER || 'baileys'); // use "baileys"
const ECHO_MODE     = envBool(process.env.ECHO_MODE, false);

// Flags de operação (sem liderança/contingência)
let intakeEnabled = envBool(process.env.INTAKE_ENABLED, true);
let sendEnabled   = envBool(process.env.SEND_ENABLED,   true);

// Redis / Outbox
const REDIS_MAIN_URL     = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';
const OUTBOX_TOPIC       = process.env.OUTBOX_TOPIC || `outbox:${process.env.WPP_SESSION || 'default'}`;
const OUTBOX_CONCURRENCY = envNum(process.env.QUEUE_OUTBOX_CONCURRENCY, 4);

const useTLS = REDIS_MAIN_URL.startsWith('rediss://');
const redisOpts = {
  lazyConnect: false,
  enableReadyCheck: true,
  connectTimeout: 8000,
  keepAlive: 15000,
  maxRetriesPerRequest: null,
  autoResubscribe: true,
  autoResendUnfulfilledCommands: true,
  retryStrategy: (times) => Math.min(30000, 1000 + times * 500),
  reconnectOnError: (err) => {
    const code = err?.code || '';
    const msg  = String(err?.message || '');
    return (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT' || msg.includes('READONLY'));
  },
  tls: useTLS ? { rejectUnauthorized: false } : undefined,
};

const outbox = await createOutbox({
  topic: OUTBOX_TOPIC,
  concurrency: OUTBOX_CONCURRENCY,
  redisUrl: REDIS_MAIN_URL,
});

// Consumidor do outbox → envia via adapter
await outbox.start(async (job) => {
  const { to, kind = 'text', payload = {} } = job || {};
  if (!to) return;
  if (!sendEnabled) {
    console.log('[outbox] SEND_DISABLED — drop', { to, kind });
    return;
  }
  if (kind === 'image') {
    const { url, caption = '' } = payload || {};
    if (url) await adapter.sendImage(to, url, caption);
    return;
  }
  const text = String(payload?.text || '');
  if (text) await adapter.sendMessage(to, text);
});

// Flows carregados
const flows = await loadFlows(BOT_ID);

// Controle simples: foto de abertura só 1x por contato
const sentOpening = new Set();

// Pagamento confirmado (pós-venda + cupom só após pagamento)
async function handlePaymentConfirmed(jid) {
  try {
    for (const line of settings.messages?.postsale_pre_coupon ?? []) {
      await outbox.publish({ to: jid, kind: 'text', payload: { text: line } });
    }
    if (settings.product?.coupon_post_payment_only && settings.product?.coupon_code) {
      const tpl = settings.messages?.postsale_after_payment_with_coupon?.[0] || '';
      const txt = tpl.replace('{{coupon_code}}', settings.product.coupon_code);
      if (txt) await outbox.publish({ to: jid, kind: 'text', payload: { text: txt } });
    }
  } catch (e) {
    console.error('[payment][confirm][error]', e);
  }
}

// ==== Áudio: baixa buffer (se o adapter expuser) e transcreve =================
async function tryGetAudioBuffer(raw) {
  try {
    if (typeof adapter?.getAudioBuffer === 'function') {
      return await adapter.getAudioBuffer(raw);
    }
    if (typeof adapter?.downloadMedia === 'function') {
      return await adapter.downloadMedia(raw, { audioOnly: true });
    }
    const m = raw?.message || raw?.msg || null;
    const hasAudio = !!m?.audioMessage || !!m?.voiceMessage || !!m?.ptt;
    if (!hasAudio) return null;
    console.warn('[ASR] áudio detectado, mas adapter não tem downloader');
    return null;
  } catch (e) {
    console.warn('[ASR] tryGetAudioBuffer:', e?.message || e);
    return null;
  }
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
  } catch (e) {
    console.warn('[ASR] transcribeIfPossible:', e?.message || e);
    return null;
  }
}

// ==== Handler principal de mensagens (sem contingência/leader) ================
adapter.onMessage(async ({ from, text, hasMedia, raw }) => {
  if (!intakeEnabled) return '';

  try {
    // (0) Foto de abertura 1x
    if (settings.flags?.send_opening_photo && !sentOpening.has(from) && settings.media?.opening_photo_url) {
      await outbox.publish({ to: from, kind: 'image',
        payload: { url: settings.media.opening_photo_url, caption: '' } });
      sentOpening.add(from);
    }

    // (1) ECHO opcional (debug)
    if (ECHO_MODE && text) {
      await outbox.publish({ to: from, kind: 'text', payload: { text: `Echo: ${text}` } });
      return '';
    }

    // (2) Texto base (ou transcrição de áudio)
    let msgText = (text || '').trim();
    if (hasMedia && !msgText) {
      const buf = await tryGetAudioBuffer(raw);
      const asr = buf ? await transcribeIfPossible(buf) : null;
      if (asr && asr.trim()) msgText = asr.trim();
    }
    if (!msgText) return '';

    // (3) Pós-venda manual
    if (/(\bpaguei\b|\bpagamento\s*feito\b|\bcomprovante\b|\bfinalizei\b)/i.test(msgText)) {
      await handlePaymentConfirmed(from);
      return '';
    }

    // (4) Intenção → prompt → LLM
    const intent = intentOf(msgText) || 'greet';
    const { system, user } = buildPrompt({ stage: intent, message: msgText });
    const { text: reply } = await callLLM({ stage: intent, system, prompt: user });

    if (reply && reply.trim()) {
      await outbox.publish({ to: from, kind: 'text', payload: { text: reply } });
      return '';
    }

    // (5) fallback simpático
    await outbox.publish({ to: from, kind: 'text',
      payload: { text: 'Consegue me contar rapidinho sobre seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?)' } });
    return '';
  } catch (e) {
    console.error('[onMessage][error]', e);
    await outbox.publish({ to: from, kind: 'text',
      payload: { text: 'Dei uma travadinha aqui, pode repetir? 💕' } });
    return '';
  }
});

// ==== Rotas HTTP ==============================================================
const sendLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Matrix IA 2.0',
    bot: BOT_ID,
    adapter: ADAPTER_NAME,
    ready: wppReady(),
    env: process.env.NODE_ENV || 'production',
    ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled },
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
    ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled },
    redis: { url: REDIS_MAIN_URL ? 'set' : 'unset', connected: outbox.isConnected() },
  });
});

// QR (html/img/png/json). QR só aparece quando **não** estiver pareado.
app.get('/wpp/qr', async (req, res) => {
  try {
    const dataURL = await getQrDataURL();
    if (!dataURL) return res.status(204).end();

    const view = (req.query.view || '').toString();
    if (view === 'img') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>QR</title></head>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0b12;color:#fff;font-family:system-ui">
  <div style="text-align:center">
    <img src="${dataURL}" alt="WhatsApp QR" style="image-rendering:pixelated;width:320px;height:320px;border-radius:12px;box-shadow:0 0 40px #0006"/>
    <p style="opacity:.7">Atualize a página para gerar um QR novo se expirar.</p>
  </div>
</body></html>`);
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

app.get('/ops/status', (_req, res) => {
  res.json({ ok: true, intake_enabled: intakeEnabled, send_enabled: sendEnabled });
});

app.post('/wpp/send', sendLimiter, async (req, res) => {
  try {
    const { to, text, imageUrl, caption } = req.body || {};
    if (!to || (!text && !imageUrl)) {
      return res.status(400).json({ ok: false, error: 'Informe { to, text } ou { to, imageUrl }' });
    }
    if (!sendEnabled) return res.status(202).json({ ok: true, enqueued: false, note: 'SEND_DISABLED — instância silenciosa' });

    if (imageUrl) await outbox.publish({ to, kind: 'image', payload: { url: imageUrl, caption: caption || '' } });
    if (text)     await outbox.publish({ to, kind: 'text', payload: { text } });
    res.json({ ok: true, enqueued: true });
  } catch (e) {
    console.error('[POST /wpp/send][error]', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Webhook simplificado de pagamento
app.post('/webhook/payment', async (req, res) => {
  try {
    const { token, to, status } = req.body || {};
    if (token !== process.env.WEBHOOK_TOKEN) return res.status(401).end();
    if (String(status).toLowerCase() === 'paid' && to) {
      await handlePaymentConfirmed(String(to));
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[webhook/payment][error]', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Inbound “manual” p/ testes
app.post('/inbound', async (req, res) => {
  try {
    const { to, text } = req.body || {};
    const jid = String(to || '').trim();
    const msg = String(text || '').trim();
    if (!jid || !msg) return res.status(400).json({ ok: false, error: 'Informe { to, text }' });
    if (!sendEnabled) return res.status(202).json({ ok: true, enqueued: false, note: 'SEND_DISABLED — instância silenciosa' });

    await outbox.publish({ to: jid, kind: 'text', payload: { text: msg } });
    res.json({ ok: true, enqueued: true });
  } catch (e) {
    console.error('[POST /inbound][error]', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Boot
const server = app.listen(PORT, HOST, () => {
  console.log(`[HTTP] Cláudia on http://${HOST}:${PORT}`);
  console.log(`[HTTP] Rotas: GET /health | GET /wpp/health | GET /wpp/qr | GET /qr | GET /ops/status | POST /wpp/send | POST /webhook/payment | POST /inbound`);
});

// Graceful shutdown
function gracefulClose(signal) {
  console.log(`[shutdown] signal=${signal}`);
  server?.close?.(() => console.log('[http] closed'));
  try { adapter?.close?.(); } catch {}
  try { outbox?.close?.(); } catch {}
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT',  () => gracefulClose('SIGINT'));
process.on('SIGTERM', () => gracefulClose('SIGTERM'));
