// src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { adapter, isReady as wppReady, getQrDataURL } from './adapters/whatsapp/index.js';
import { createOutbox } from './core/queue.js';

import { BOT_ID } from './core/settings.js';
import { loadFlows } from './core/flow-loader.js';
import { intentOf } from './core/intent.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ADAPTER_NAME = String(process.env.WPP_ADAPTER || 'baileys');
const ECHO_MODE = String(process.env.ECHO_MODE || 'false').toLowerCase() === 'true';

// --------- Fila Outbox ---------
const OUTBOX_TOPIC = process.env.OUTBOX_TOPIC || `outbox:${process.env.WPP_SESSION || 'default'}`;
const OUTBOX_CONCURRENCY = Number(process.env.QUEUE_OUTBOX_CONCURRENCY || '4');

const outbox = await createOutbox({
  topic: OUTBOX_TOPIC,
  concurrency: OUTBOX_CONCURRENCY,
  redisUrl: process.env.REDIS_URL || '',
});

// Consumer: envia via adapter
await outbox.start(async (job) => {
  const { to, kind = 'text', payload = {} } = job || {};
  if (!to) return;
  if (kind === 'image') {
    const { url, caption = '' } = payload || {};
    if (url) await adapter.sendImage(to, url, caption);
    return;
  }
  const text = String(payload?.text || '');
  if (text) await adapter.sendMessage(to, text);
});

// --------- Flows ---------
const flows = await loadFlows(BOT_ID);

adapter.onMessage(async ({ from, text, hasMedia, raw }) => {
  try {
    if (ECHO_MODE && text) {
      await outbox.publish({ to: from, kind: 'text', payload: { text: `Echo: ${text}` } });
      return '';
    }

    if (!text && !hasMedia) return '';

    const intent = intentOf(text);
    const handler = flows[intent] || flows[intent?.toLowerCase?.()];
    if (typeof handler === 'function') {
      const reply = await handler({ userId: from, text, context: { hasMedia, raw } });
      if (typeof reply === 'string' && reply.trim()) {
        await outbox.publish({ to: from, kind: 'text', payload: { text: reply } });
      }
      return '';
    }

    // fallback
    await outbox.publish({
      to: from,
      kind: 'text',
      payload: { text: 'Consegue me contar rapidinho sobre seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?)' },
    });
    return '';
  } catch (e) {
    console.error('[onMessage][error]', e);
    await outbox.publish({ to: from, kind: 'text', payload: { text: 'Dei uma travadinha aqui, pode repetir? 💕' } });
    return '';
  }
});

// --------- Limiters ---------
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// --------- Rotas ---------
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Matrix IA 2.0',
    bot: BOT_ID,
    adapter: ADAPTER_NAME,
    ready: wppReady(),
    env: process.env.NODE_ENV || 'production',
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
    redis: {
      url: process.env.REDIS_URL ? 'set' : 'unset',
      connected: outbox.isConnected(),
    },
  });
});

app.get('/wpp/qr', async (_req, res) => {
  try {
    const dataURL = await getQrDataURL();
    if (!dataURL) return res.status(204).end();
    res.json({ ok: true, qr: dataURL, bot: BOT_ID, adapter: ADAPTER_NAME });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Envio manual (passa pela fila!)
app.post('/wpp/send', sendLimiter, async (req, res) => {
  try {
    const { to, text, imageUrl, caption } = req.body || {};
    if (!to || (!text && !imageUrl)) {
      return res.status(400).json({ ok: false, error: 'Informe { to, text } ou { to, imageUrl }' });
    }
    if (imageUrl) await outbox.publish({ to, kind: 'image', payload: { url: imageUrl, caption: caption || '' } });
    if (text)     await outbox.publish({ to, kind: 'text',  payload: { text } });
    res.json({ ok: true, enqueued: true });
  } catch (e) {
    console.error('[POST /wpp/send][error]', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// --------- Boot ---------
app.listen(PORT, HOST, () => {
  console.log(`[HTTP] Matrix on http://${HOST}:${PORT}`);
  console.log(`[HTTP] Rotas: GET /health | GET /wpp/health | GET /wpp/qr | POST /wpp/send`);
});
