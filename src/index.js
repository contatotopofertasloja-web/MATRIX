// src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
- import { makeAdapter } from './adapters/whatsapp/index.js';
+ import wpp from './adapters/whatsapp/index.js';
+ const makeAdapter = wpp?.makeAdapter ?? wpp; // aceita default function OU { makeAdapter }
import { makeAdapter } from './adapters/whatsapp/index.js'; // factory multi-sessão (ok) [base do seu projeto]
import { BOT_ID, settings } from './core/settings.js';
import { loadFlows } from './core/flow-loader.js';
import { intentOf } from './core/intent.js';

// Fila (dispatcher)
import { enqueueOutbox, startOutboxWorkers } from './core/queue/dispatcher.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

// sessões
const SESSION_MAIN = process.env.WPP_SESSION || 'claudia-main';
const SESSION_RESERVA = process.env.WPP_SESSION_RESERVA || 'claudia-reserva';

// tópicos de saída (fila)
const OUTBOX_MAIN = process.env.OUTBOX_TOPIC || `outbox:${SESSION_MAIN}`;
const OUTBOX_RESERVA = process.env.OUTBOX_TOPIC_RESERVA || `outbox:${SESSION_RESERVA}`;

// quantos workers por fila
const OUTBOX_CONC = Number(process.env.QUEUE_OUTBOX_CONCURRENCY || 2);
// rate global por sessão (msgs/seg) — ex.: 0.5 => 1 msg/2s
const RATE_PER_SEC = Number(process.env.QUEUE_RATE_PER_SEC || 0.5);

// adapters
const adapterMain = makeAdapter({ session: SESSION_MAIN });
const adapterReserva = makeAdapter({ session: SESSION_RESERVA });

// flows
const flows = await loadFlows(BOT_ID);

// handler principal
adapterMain.onMessage(async (msg) => {
  try {
    const { from, text, hasMedia, mediaType } = msg || {};
    let finalText = text || '';

    // Se tiver mídia de áudio e você já tiver util de ASR plugado, pode transcrever.
    // Mantive simples: se precisar, integre seu getAudioBuffer + transcribe aqui.

    if (!finalText && !hasMedia) return '';

    const intent = intentOf(finalText);
    const handler = flows[intent] || flows[intent?.toLowerCase?.()] || null;

    // se houver handler, ele pode devolver string (texto) ou {type:'image', imageUrl, caption}
    if (typeof handler === 'function') {
      const reply = await handler({ userId: from, text: finalText, context: { hasMedia, mediaType } });

      if (typeof reply === 'string' && reply.trim()) {
        await enqueueOutbox({
          topic: OUTBOX_MAIN,
          to: from,
          content: { kind: 'text', text: reply.trim() },
          meta: { session: SESSION_MAIN, bot: BOT_ID }
        });
        return '';
      }
      if (reply && typeof reply === 'object' && reply.type === 'image' && reply.imageUrl) {
        await enqueueOutbox({
          topic: OUTBOX_MAIN,
          to: from,
          content: { kind: 'image', imageUrl: reply.imageUrl, caption: reply.caption || '' },
          meta: { session: SESSION_MAIN, bot: BOT_ID }
        });
        return '';
      }
      return '';
    }

    // fallback
    await enqueueOutbox({
      topic: OUTBOX_MAIN,
      to: from,
      content: { kind: 'text', text: 'Consegue me contar rapidinho como é seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?)' },
      meta: { session: SESSION_MAIN, bot: BOT_ID }
    });
    return '';
  } catch (e) {
    console.error('[onMessage][error]', e);
    return 'Dei uma travadinha aqui, pode repetir? 💕';
  }
});

// sobe workers (consomem a fila e chamam o adapter pra enviar)
await startOutboxWorkers({
  topic: OUTBOX_MAIN,
  concurrency: OUTBOX_CONC,
  ratePerSec: RATE_PER_SEC,
  sendFn: async (to, payload) => {
    if (payload?.kind === 'image') {
      return adapterMain.sendImage(to, payload.imageUrl, payload.caption || '');
    }
    return adapterMain.sendMessage(to, String(payload?.text ?? ''));
  },
});

// reserva (opcional)
await startOutboxWorkers({
  topic: OUTBOX_RESERVA,
  concurrency: OUTBOX_CONC,
  ratePerSec: RATE_PER_SEC,
  sendFn: async (to, payload) => {
    if (payload?.kind === 'image') {
      return adapterReserva.sendImage(to, payload.imageUrl, payload.caption || '');
    }
    return adapterReserva.sendMessage(to, String(payload?.text ?? ''));
  },
});

// endpoints
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'Matrix IA 2.0', bot: BOT_ID });
});

app.get('/wpp/health', async (_req, res) => {
  try {
    const mainReady = await adapterMain.isReady?.();
    const resvReady = await adapterReserva.isReady?.();
    res.json({ ok: true, sessions: { main: !!mainReady, reserva: !!resvReady } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get('/wpp/qr', async (_req, res) => {
  try {
    const dataURL = await adapterMain.getQrDataURL();
    if (!dataURL) return res.status(204).end();
    res.json({ session: 'main', dataURL });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/wpp/qr/reserva', async (_req, res) => {
  try {
    const dataURL = await adapterReserva.getQrDataURL();
    if (!dataURL) return res.status(204).end();
    res.json({ session: 'reserva', dataURL });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// envio manual (teste rápido)
app.post('/wpp/send', async (req, res) => {
  try {
    const { to, text, type, imageUrl, caption, session = 'main' } = req.body || {};
    if (!to) return res.status(400).json({ error: 'Informe { to }' });

    const topic = session === 'reserva' ? OUTBOX_RESERVA : OUTBOX_MAIN;

    if (type === 'image' && imageUrl) {
      await enqueueOutbox({ topic, to, content: { kind: 'image', imageUrl, caption: caption || '' }, meta: { session } });
      return res.json({ ok: true });
    }
    if (!text) return res.status(400).json({ error: 'Informe { text } ou { type:"image", imageUrl }' });
    await enqueueOutbox({ topic, to, content: { kind: 'text', text: String(text) }, meta: { session } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// (opcional) saúde da fila
app.get('/queue/health', (_req, res) => {
  res.json({
    ok: true,
    outbox: {
      main: OUTBOX_MAIN,
      reserva: OUTBOX_RESERVA,
      ratePerSec: RATE_PER_SEC,
      workersPerTopic: OUTBOX_CONC
    }
  });
});

app.listen(PORT, HOST, () => {
  console.log(`[server] Matrix on http://${HOST}:${PORT}`);
});
