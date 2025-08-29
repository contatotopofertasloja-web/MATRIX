// src/index.js
import 'dotenv/config';
import express from 'express';
import { withRateLimit } from './middlewares/rateLimit.js';
import { adapter, getQrDataURL, isReady } from './index-gpt.js'; // usa o adapter Baileys novo
import { bot } from './bot.js';
import { EFFECTIVE_MODEL } from './model.js';

const app = express();

// Middlewares básicos
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1); // importante no Railway atrás de proxy

// Debug rápido
app.get('/__ping', (_req, res) => res.type('text').send('pong'));
app.get('/__routes', (_req, res) => {
  const list = [];
  app._router?.stack?.forEach((r) => {
    if (r.route && r.route.path) {
      list.push(`${Object.keys(r.route.methods).join(',').toUpperCase()} ${r.route.path}`);
    }
  });
  res.json(list);
});

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/wpp/health', (_req, res) => res.json({ ok: isReady() }));

// Modelo GPT ativo
app.get('/gpt-model', (_req, res) => {
  res.json({
    env_model: (process.env.MODEL_NAME || '').trim() || null,
    effective_model: EFFECTIVE_MODEL,
    node: process.version,
    env: process.env.NODE_ENV || 'dev'
  });
});

// QR do WhatsApp
app.get('/wpp/qr', async (_req, res) => {
  try {
    if (isReady()) return res.type('text').send('WPP já conectado ✅');
    const dataUrl = await getQrDataURL();
    if (!dataUrl) return res.type('text').send('Aguardando QR ser gerado... atualize em 2–3s');
    res.type('html').send(`
      <html><body style="font-family:sans-serif">
        <h3>Escaneie o QR no WhatsApp &gt; Dispositivos conectados</h3>
        <img src="${dataUrl}" style="width:300px;height:300px" />
      </body></html>
    `);
  } catch (e) {
    console.error('[WPP][QR][ERR]', e);
    res.status(500).send('erro ao gerar QR');
  }
});

// Alias opcional
app.get('/qr', (_req, res) => res.redirect(302, '/wpp/qr'));

// Webhook universal (compatível com Meta)
app.post('/webhook', withRateLimit({ windowMs: 3000 }), async (req, res) => {
  const started = Date.now();
  try {
    let userId, text;
    const context = req.body?.context || {};

    if (req.body?.userId && typeof req.body?.text === 'string') {
      userId = String(req.body.userId);
      text = String(req.body.text || '');
    } else if (Array.isArray(req.body?.entry)) {
      const entry = req.body.entry[0];
      const change = entry?.changes?.[0];
      const m = change?.value?.messages?.[0];
      userId = m?.from;
      text = m?.text?.body || '';
    }

    if (!userId || !String(text).trim()) {
      return res.status(400).json({ error: 'invalid payload', got: req.body });
    }

    const reply = await bot.handleMessage({ userId, text, context });
    res.json({ reply, took_ms: Date.now() - started });
  } catch (err) {
    console.error('[WEBHOOK][ERR]', err);
    res.json({
      reply: 'Tivemos uma instabilidade rápida aqui. Posso te ajudar por aqui mesmo? 😊',
      fallback: true
    });
  }
});

// Start HTTP
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
const server = app.listen(port, host, () => {
  console.log(`[HTTP] Listening on ${host}:${port}`);
});

// Liga Baileys pelo adapter
adapter.onMessage(async ({ from, text, hasMedia }) => {
  if (!text && !hasMedia) return;
  const reply = await bot.handleMessage({ userId: from, text, context: { hasMedia } });
  return reply;
});

// Tratamento de erros globais
server.on('error', (err) => console.error('[HTTP][ERROR]', err?.message || err));
process.on('uncaughtException', (err) => console.error('[UNCAUGHT]', err));
process.on('unhandledRejection', (r) => console.error('[UNHANDLED]', r));
