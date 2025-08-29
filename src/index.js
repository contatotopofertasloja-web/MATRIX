// src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { adapter, isReady as wppReady, getQrDataURL } from './adapters/whatsapp/index.js';
import botDefault, { handleMessage as botHandle, initBot } from './bot.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

// Bind do handler de mensagens do WhatsApp → BOT
adapter.onMessage(async ({ from, text, hasMedia }) => {
  try {
    const reply = await (botHandle ?? botDefault.handleMessage)({ userId: from, text, context: { hasMedia } });
    return typeof reply === 'string' ? reply : '';
  } catch (e) {
    console.error('[server][onMessage] error:', e?.message || e);
    return 'Ops! Tive um probleminha aqui. Pode repetir a última mensagem, por favor? 🙏';
  }
});

// Health
app.get('/wpp/health', (_req, res) => {
  res.json({ ok: true, ready: wppReady(), adapter: process.env.WPP_ADAPTER || 'baileys' });
});

// QR (DataURL)
app.get('/wpp/qr', async (_req, res) => {
  try {
    const dataURL = await getQrDataURL();
    if (!dataURL) return res.status(204).end();
    res.json({ dataURL });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Envio manual (útil p/ teste)
app.post('/wpp/send', async (req, res) => {
  try {
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ error: 'Informe { to, text }' });
    await adapter.sendMessage(to, text);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

(async () => {
  try {
    await (initBot ? initBot() : Promise.resolve());
    app.listen(PORT, HOST, () => {
      console.log(`[server] Matrix on http://${HOST}:${PORT} — adapter=${process.env.WPP_ADAPTER || 'baileys'}`);
    });
  } catch (e) {
    console.error('[server][boot] error:', e?.message || e);
    process.exitCode = 1;
  }
})();
