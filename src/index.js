// src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

// Adapters (principal + reserva)
import { makeAdapter } from './adapters/whatsapp/index.js';
import { getAudioBuffer } from './adapters/whatsapp/baileys/index.js';
import { transcribeAudioBuffer } from './core/asr.js';
import { BOT_ID, settings } from './core/settings.js';
import { loadFlows } from './core/flow-loader.js';
import { intentOf } from './core/intent.js';

const BACKEND = (process.env.QUEUE_BACKEND || 'redis').toLowerCase();
const USE_QUEUE = BACKEND !== 'none';

// Sessões
const SESSION_MAIN = process.env.WPP_SESSION || 'claudia-main';
const OUTBOX_MAIN = process.env.OUTBOX_TOPIC || `outbox:${SESSION_MAIN}`;
const SESSION_RESERVA = process.env.WPP_SESSION_RESERVA || 'claudia-reserva';
const OUTBOX_RESERVA = process.env.OUTBOX_TOPIC_RESERVA || `outbox:${SESSION_RESERVA}`;
const OUTBOX_CONC = Number(process.env.QUEUE_OUTBOX_CONCURRENCY || 2);

// Instancia adapters
const adapterMain = makeAdapter({ session: SESSION_MAIN });
const adapterReserva = makeAdapter({ session: SESSION_RESERVA });

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ECHO_MODE = String(process.env.ECHO_MODE || 'false').toLowerCase() === 'true';

// Carrega flows
const flows = await loadFlows(BOT_ID);

// ————————————————————————————————————————
// Handlers de mensagens (aqui só pluguei no principal)
// ————————————————————————————————————————
adapterMain.onMessage(async (msg) => {
  try {
    const { from, text, hasMedia, mediaType, mimeType, raw } = msg || {};
    if (ECHO_MODE && text) return `Echo: ${text}`;
    let finalText = text || '';
    if (!finalText && hasMedia && mediaType === 'audio') {
      const media = await getAudioBuffer(raw);
      if (media?.buffer?.length) {
        const transcript = await transcribeAudioBuffer(media.buffer, media.mimeType || mimeType);
        if (transcript) finalText = transcript;
      }
    }
    if (!finalText) return '';
    const intent = intentOf(finalText);
    const handler = flows[intent] || flows[intent?.toLowerCase?.()] || null;
    if (typeof handler === 'function') {
      const reply = await handler({ userId: from, text: finalText, context: { hasMedia, mediaType } });
      if (typeof reply === 'string') return reply || '';
      if (reply && typeof reply === 'object' && reply.type === 'image' && reply.imageUrl) {
        return { type: 'image', imageUrl: reply.imageUrl, caption: reply.caption || '' };
      }
      return '';
    }
    return 'Consegue me contar rapidinho como é seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?)';
  } catch (e) {
    console.error('[onMessage][error]', e);
    return 'Dei uma travadinha aqui, pode repetir? 💕';
  }
});

// ————————————————————————————————————————
// Workers de fila (principal + reserva)
// ————————————————————————————————————————
if (USE_QUEUE) {
  const { startOutboxWorkers } = await import('./core/queue/dispatcher.js');
  await startOutboxWorkers({
    topic: OUTBOX_MAIN,
    concurrency: OUTBOX_CONC,
    sendFn: async (to, content) => {
      if (typeof content === 'string') await adapterMain.sendMessage(to, content);
      else if (content?.type === 'image') await adapterMain.sendImage(to, content.imageUrl, content.caption || '');
    },
  });
  await startOutboxWorkers({
    topic: OUTBOX_RESERVA,
    concurrency: OUTBOX_CONC,
    sendFn: async (to, content) => {
      if (typeof content === 'string') await adapterReserva.sendMessage(to, content);
      else if (content?.type === 'image') await adapterReserva.sendImage(to, content.imageUrl, content.caption || '');
    },
  });
}

// ————————————————————————————————————————
// Endpoints HTTP
// ————————————————————————————————————————
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'Matrix IA 2.0', bot: BOT_ID, ready: true });
});

// QR principal
app.get('/wpp/qr', async (_req, res) => {
  try {
    const dataURL = await adapterMain.getQrDataURL();
    if (!dataURL) return res.status(204).end();
    res.json({ session: 'main', dataURL });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// QR reserva
app.get('/wpp/qr/reserva', async (_req, res) => {
  try {
    const dataURL = await adapterReserva.getQrDataURL();
    if (!dataURL) return res.status(204).end();
    res.json({ session: 'reserva', dataURL });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[server] Matrix on http://${HOST}:${PORT}`);
});
