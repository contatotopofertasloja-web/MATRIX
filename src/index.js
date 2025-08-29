// src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { adapter, isReady as wppReady, getQrDataURL } from './adapters/whatsapp/index.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

/**
 * Handler mínimo de mensagens.
 * - Por padrão NÃO responde (retorna string vazia) para evitar SPAM.
 * - Se quiser testar rápido, defina ECHO_MODE=true no .env para ecoar a mensagem.
 */
const ECHO_MODE = String(process.env.ECHO_MODE || 'false').toLowerCase() === 'true';

adapter.onMessage(async ({ from, text, hasMedia }) => {
  try {
    if (ECHO_MODE && text) return `Echo: ${text}`;
    // aqui você pode plugar seu fluxo/LLM quando quiser:
    // const reply = await handleMessage({ userId: from, text, context: { hasMedia } });
    // return typeof reply === 'string' ? reply : '';
    return '';
  } catch (e) {
    console.error('[server][onMessage] error:', e?.message || e);
    return 'Ops! Deu um probleminha por aqui — pode repetir, por favor? 🙏';
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
    if (!dataURL) return res.status(204).end(); // ainda não gerado / já conectado
    res.json({ dataURL });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Envio manual (teste)
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

// Boot HTTP
app.listen(PORT, HOST, () => {
  console.log(`[server] Matrix on http://${HOST}:${PORT} — adapter=${process.env.WPP_ADAPTER || 'baileys'}`);
});
