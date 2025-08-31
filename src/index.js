// src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { adapter, isReady as wppReady, getQrDataURL } from './adapters/whatsapp/index.js';
import { getAudioBuffer } from './adapters/whatsapp/baileys/index.js';
import { transcribeAudioBuffer } from './core/asr.js';

import { BOT_ID, settings } from './core/settings.js';
import { loadFlows } from './core/flow-loader.js';
import { intentOf } from './core/intent.js';

// ——— Hub/Fila ———
const BACKEND = (process.env.QUEUE_BACKEND || 'redis').toLowerCase(); // redis | memory | rabbit | sqs | none
const USE_QUEUE = BACKEND !== 'none';
const SESSION_ID = process.env.WPP_SESSION || 'claudia-main';
const OUTBOX_TOPIC = process.env.OUTBOX_TOPIC || `outbox:${SESSION_ID}`;
const OUTBOX_CONC = Number(process.env.QUEUE_OUTBOX_CONCURRENCY || 2);

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const ECHO_MODE = String(process.env.ECHO_MODE || 'false').toLowerCase() === 'true';

// Carrega flows do bot
const flows = await loadFlows(BOT_ID);

// ————————————————————————————————————————
// Handler de mensagens (texto + áudio)
// ————————————————————————————————————————
adapter.onMessage(async (msg) => {
  try {
    const { from, text, hasMedia, mediaType, mimeType, raw } = msg || {};

    // 1) ECHO simples
    if (ECHO_MODE && text) return `Echo: ${text}`;

    let finalText = text || '';

    // 2) ÁUDIO → transcrição
    if (!finalText && hasMedia && mediaType === 'audio') {
      const media = await getAudioBuffer(raw);
      if (media?.buffer?.length) {
        const transcript = await transcribeAudioBuffer(media.buffer, media.mimeType || mimeType);
        if (transcript) finalText = transcript;
      }
    }

    if (!finalText) return '';

    // 3) Intenção → flow
    const intent = intentOf(finalText);
    const handler = flows[intent] || flows[intent?.toLowerCase?.()] || null;

    if (typeof handler === 'function') {
      const reply = await handler({
        userId: from,
        text: finalText,
        context: { hasMedia, mediaType },
      });

      // Se o flow retornar string → texto normal
      if (typeof reply === 'string') return reply || '';

      // Se o flow retornar objeto de IMAGEM (ex.: { type:'image', imageUrl, caption })
      if (reply && typeof reply === 'object' && reply.type === 'image' && reply.imageUrl) {
        // quando retorna objeto aqui, o adapter vai enfileirar/enviar conforme config
        return { type: 'image', imageUrl: reply.imageUrl, caption: reply.caption || '' };
      }

      return '';
    }

    // 4) Defaults (fallback)
    switch (intent) {
      case 'delivery': return 'Me passa seu CEP rapidinho que já te confirmo prazo e frete 🚚';
      case 'payment':  return 'Temos Pagamento na Entrega (COD). Se preferir, posso te passar outras opções.';
      case 'features': return 'É um tratamento sem formol que alinha e nutre. Quer o passo a passo de uso?';
      case 'objection':return 'Te entendo! É regularizado e com garantia. Quer que eu te mostre resultados e modo de uso?';
      default:         return 'Consegue me contar rapidinho como é seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?)';
    }
  } catch (e) {
    console.error('[onMessage][error]', e);
    return 'Dei uma travadinha aqui, pode repetir? 💕';
  }
});

// ————————————————————————————————————————
// Sobe os workers da fila (Matrix 2.0 — Hub + Redis)
// ————————————————————————————————————————
if (USE_QUEUE) {
  const { startOutboxWorkers } = await import('./core/queue/dispatcher.js');
  startOutboxWorkers({
    topic: OUTBOX_TOPIC,
    concurrency: OUTBOX_CONC,
    // ⬇️ Aceita TEXTO (string) ou OBJETO (ex.: {type:'image', imageUrl, caption})
    sendFn: async (to, content) => {
      const { sendMessage, sendImage } = adapter;
      if (typeof content === 'string') {
        await sendMessage(to, content);
      } else if (content && typeof content === 'object' && content.type === 'image' && content.imageUrl) {
        await sendImage(to, content.imageUrl, content.caption || '');
      } else {
        // conteúdo desconhecido → ignora silenciosamente
      }
    },
  }).catch(e => console.error('[outbox] failed to start workers:', e?.message || e));
}
// (Worker acima casa com o backend Redis que já ajustamos para repassar objeto/string) :contentReference[oaicite:1]{index=1}

// ————————————————————————————————————————
// Endpoints HTTP
// ————————————————————————————————————————
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Matrix IA 2.0',
    bot: BOT_ID,
    ready: wppReady(),
    env: process.env.NODE_ENV || 'production',
  });
});

app.get('/wpp/health', (_req, res) => {
  res.json({ ok: true, ready: wppReady(), adapter: process.env.WPP_ADAPTER || 'baileys' });
});

app.get('/wpp/qr', async (_req, res) => {
  try {
    const dataURL = await getQrDataURL();
    if (!dataURL) return res.status(204).end();
    res.json({ dataURL });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Aceita TEXTO (string) ou IMAGEM (objeto) via HTTP
app.post('/wpp/send', async (req, res) => {
  try {
    const { to, text, content, imageUrl, caption } = req.body || {};
    if (!to) return res.status(400).json({ error: 'Informe { to, ... }' });

    // Normaliza payload: prioriza `content`, senão monta a partir de imageUrl/caption, senão usa text
    const payload = content ?? (imageUrl ? { type: 'image', imageUrl, caption } : text);
    if (payload == null || (typeof payload !== 'string' && typeof payload !== 'object')) {
      return res.status(400).json({ error: 'Envie { text: "..." } ou { content: {type:"image", imageUrl, caption} }' });
    }

    if (USE_QUEUE) {
      const { enqueueOutbox } = await import('./core/queue/dispatcher.js');
      await enqueueOutbox({
        topic: OUTBOX_TOPIC,
        to,
        text: payload, // string OU objeto (Redis backend já suporta)
        meta: { session: SESSION_ID, api: true },
      });
      return res.json({ ok: true, queued: true });
    }

    // envio direto (sem fila)
    if (typeof payload === 'string') {
      await adapter.sendMessage(to, payload);
    } else if (payload?.type === 'image' && payload.imageUrl) {
      await adapter.sendImage(to, payload.imageUrl, payload.caption || '');
    }
    res.json({ ok: true, queued: false });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ————————————————————————————————————————
// DEBUG endpoints
// ————————————————————————————————————————
app.post('/debug/intent', (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Informe { text }' });
    const intent = intentOf(text);
    res.json({ intent });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/debug/settings', (_req, res) => {
  res.json(settings);
});

// ————————————————————————————————————————
app.listen(PORT, HOST, () => {
  console.log(`[server] Matrix on http://${HOST}:${PORT}`);
});
