// src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { makeAdapter } from './adapters/whatsapp/index.js';
import { enqueueOutbox, startOutboxWorkers } from './core/queue/dispatcher.js';

// ====== Env / Defaults ======
const PORT = Number(process.env.PORT || 3000);

const SESSION_MAIN =
  process.env.WPP_SESSION ||
  process.env.WHATSAPP_SESSION ||
  process.env.SESSION ||
  'claudia-main';

const OUTBOX_TOPIC =
  process.env.OUTBOX_TOPIC || `outbox:${SESSION_MAIN}`;

const QUEUE_BACKEND =
  (process.env.QUEUE_BACKEND || 'memory').toLowerCase();

const QUEUE_OUTBOX_CONCURRENCY =
  Number(process.env.QUEUE_OUTBOX_CONCURRENCY || 4);

// ====== Adapter (factory por sessão) ======
const adapter = makeAdapter({ session: SESSION_MAIN });

await adapter.onMessage?.(async (msg) => {
  // coloque aqui o roteamento para o seu flow/greet quando quiser
});

// ====== Workers da outbox ======
if (QUEUE_BACKEND !== 'none') {
  startOutboxWorkers({
    topic: OUTBOX_TOPIC,
    concurrency: QUEUE_OUTBOX_CONCURRENCY,
    sendFn: async (job) => {
      const { to, type = 'text', text, imageUrl, caption } = job || {};
      if (!to) throw new Error('Payload inválido: "to" ausente');
      if (type === 'image') return adapter.sendImage?.(to, imageUrl, caption || '');
      return adapter.sendMessage?.(to, text ?? '');
    },
  });
}

// ====== HTTP API ======
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

app.get('/wpp/health', async (_req, res) => {
  try {
    const ready = await adapter.isReady?.();
    res.json({ ok: true, ready: !!ready, session: SESSION_MAIN, backend: QUEUE_BACKEND, topic: OUTBOX_TOPIC });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.get('/wpp/qr', async (_req, res) => {
  try {
    const dataUrl = await adapter.getQrDataURL?.();
    if (!dataUrl) return res.status(404).json({ ok: false, error: 'QR indisponível' });
    res.json({ ok: true, dataUrl });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.post('/wpp/send', async (req, res) => {
  try {
    const { to, text, imageUrl, caption } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, error: '"to" é obrigatório' });

    const payload = imageUrl
      ? { type: 'image', to, imageUrl, caption: caption || '' }
      : { type: 'text', to, text: text ?? '' };

    await enqueueOutbox({ topic: OUTBOX_TOPIC, ...payload, meta: { session: SESSION_MAIN } });
    res.json({ ok: true, queued: true, topic: OUTBOX_TOPIC });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.post('/wpp/send-direct', async (req, res) => {
  try {
    const { to, text, imageUrl, caption } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, error: '"to" é obrigatório' });
    const result = imageUrl
      ? await adapter.sendImage?.(to, imageUrl, caption || '')
      : await adapter.sendMessage?.(to, text ?? '');
    res.json({ ok: true, direct: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`[MATRIX-WPP] up on :${PORT} | session=${SESSION_MAIN} | backend=${QUEUE_BACKEND} | topic=${OUTBOX_TOPIC}`);
});
