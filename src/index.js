// src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { adapter, isReady as wppReady, getQrDataURL } from './adapters/whatsapp/index.js';

// Core
import { BOT_ID } from './core/settings.js';
import { loadFlows } from './core/flow-loader.js';
import { intentOf } from './core/intent.js';

// ---------------------------------------------
// App base
// ---------------------------------------------
const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

// ---------------------------------------------
// Configs e flags
// ---------------------------------------------
const ECHO_MODE = String(process.env.ECHO_MODE || 'false').toLowerCase() === 'true';
const ADAPTER_NAME = String(process.env.WPP_ADAPTER || 'baileys');

// Rate limit só para envio manual
const sendLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------------------------------------------
// Carregar flows do BOT
// ---------------------------------------------
const flows = await loadFlows(BOT_ID);

// ---------------------------------------------
// Pipeline de mensagens vindas do WhatsApp
// ---------------------------------------------
adapter.onMessage(async ({ from, text, hasMedia, raw }) => {
  try {
    // Modo debug (eco)
    if (ECHO_MODE && text) return `Echo: ${text}`;

    if (!text && !hasMedia) return '';

    const intent = intentOf(text);
    const handler = flows[intent] || flows[intent?.toLowerCase?.()] || null;

    if (typeof handler === 'function') {
      const reply = await handler({
        userId: from,
        text,
        context: { hasMedia, raw },
      });
      return typeof reply === 'string' ? reply : '';
    }

    // Defaults úteis
    switch (intent) {
      case 'delivery':
        return 'Me passa seu CEP rapidinho que já te confirmo prazo e frete 🚚';
      case 'payment':
        return 'Temos Pagamento na Entrega (COD). Se preferir, posso te passar outras opções também.';
      case 'features':
        return 'É um tratamento sem formol que alinha e nutre. Quer o passo a passo de uso?';
      case 'objection':
        return 'Te entendo! É produto regularizado, com garantia e suporte. Posso te mandar resultados e como usar?';
      default:
        return 'Consegue me contar rapidinho sobre seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?)';
    }
  } catch (e) {
    console.error('[onMessage][error]', e);
    return 'Dei uma travadinha aqui, pode repetir? 💕';
  }
});

// ---------------------------------------------
// Rotas HTTP
// ---------------------------------------------
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
  res.json({ ok: true, ready: wppReady(), adapter: ADAPTER_NAME });
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

app.post('/wpp/send', sendLimiter, async (req, res) => {
  try {
    const { to, text, imageUrl, caption } = req.body || {};
    if (!to || (!text && !imageUrl)) {
      return res.status(400).json({ ok: false, error: 'Informe { to, text } ou { to, imageUrl }' });
    }

    if (imageUrl) await adapter.sendImage(to, imageUrl, caption || '');
    if (text) await adapter.sendMessage(to, text);

    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /wpp/send][error]', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---------------------------------------------
// Start server
// ---------------------------------------------
app.listen(PORT, HOST, () => {
  console.log(`[HTTP] Matrix rodando em http://${HOST}:${PORT}`);
  console.log(`[HTTP] Rotas: GET /health | GET /wpp/health | GET /wpp/qr | POST /wpp/send`);
});
