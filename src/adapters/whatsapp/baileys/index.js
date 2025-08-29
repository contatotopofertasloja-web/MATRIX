// src/index.js
// Server HTTP + WhatsApp adapter + handler MVP da Cláudia

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';

import {
  adapter,        // { onMessage(fn), sendMessage(to, text), sendImage(to, url, caption) }
  isReady,        // -> boolean
  getQrDataURL    // -> dataURL (base64) do QR ou null
} from './adapters/whatsapp/baileys/index.js';

// ---------------------------
// Config básica
// ---------------------------
const PORT = Number(process.env.PORT || 8080);
const app  = express();

// Atrás de proxy (Railway/Ingress)
app.set('trust proxy', 1);

// Middlewares úteis
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// Rate limit leve (protege endpoints públicos)
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 min
    max: 60,             // 60 req/min por IP
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ---------------------------
// Endpoints de health/diagnóstico
// ---------------------------
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'matrix-wpp',
    ts: new Date().toISOString(),
    uptime_s: Math.round(process.uptime()),
    env: process.env.NODE_ENV || 'development',
  });
});

app.get('/wpp/health', (req, res) => {
  res.json({
    ok: true,
    ready: isReady(),
  });
});

// Retorna o QR em dataURL (para UI/Web)
app.get('/wpp/qr', async (req, res) => {
  const dataUrl = await getQrDataURL();
  if (!dataUrl) return res.status(204).end(); // sem conteúdo quando já conectado
  res.json({ ok: true, qr: dataUrl });
});

// ---------------------------
// Endpoint utilitário: disparo manual de teste
// ---------------------------
app.post('/wpp/send', async (req, res) => {
  try {
    const { to, text, imageUrl, caption } = req.body || {};
    if (!to || (!text && !imageUrl)) {
      return res.status(400).json({ ok: false, error: 'Informe "to" e "text" ou "imageUrl".' });
    }

    if (imageUrl) {
      await adapter.sendImage(to, imageUrl, caption || '');
    }
    if (text) {
      await adapter.sendMessage(to, text);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /wpp/send][ERR]', err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// ---------------------------
// Pipeline de mensagens (Cláudia MVP)
// ---------------------------
// Regras rápidas para já responder:
// - "ping" -> "pong"
// - Saudações -> apresentação
// - Fallback -> eco educado
adapter.onMessage(async ({ from, text, hasMedia }) => {
  try {
    if (!text && !hasMedia) return;

    // Se for mídia (áudio/foto/vídeo/doc), peça resumo por texto
    if (hasMedia && !text) {
      return await adapter.sendMessage(
        from,
        'Consigo te ajudar mais rápido por texto 💕 Me conta rapidinho o que você precisa?'
      );
    }

    const t = (text || '').trim();

    // Regras MVP
    if (/^ping$/i.test(t)) {
      return await adapter.sendMessage(from, 'pong');
    }

    if (/^(oi|olá|ola|bom dia|boa tarde|boa noite)\b/i.test(t)) {
      return await adapter.sendMessage(from, 'Oi! Eu sou a Cláudia 😊 Como posso te ajudar?');
    }

    // Fallback educado (eco)
    const reply = `Você disse: "${t}". Me conta um pouco mais pra eu te ajudar.`;
    await adapter.sendMessage(from, reply);
  } catch (err) {
    console.error('[onMessage][ERR]', err);
    try {
      await adapter.sendMessage(from, 'Dei uma travadinha aqui, pode repetir? 💕');
    } catch {}
  }
});

// ---------------------------
// Start
// ---------------------------
app.listen(PORT, () => {
  console.log(`[HTTP] Servidor rodando na porta ${PORT}`);
  console.log('[HTTP] Health: GET /health | WhatsApp: GET /wpp/health, GET /wpp/qr');
});
