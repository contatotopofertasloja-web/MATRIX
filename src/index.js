// src/index.js
// Boot da API + integração da fila de outbox que já existe em core/queue/dispatcher.js

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { makeAdapter } from './adapters/whatsapp/index.js';
import { enqueueOutbox, startOutboxWorkers } from './core/queue/dispatcher.js';

// ====== Env / Defaults ======
const PORT = Number(process.env.PORT || 3000);

// sessão principal (padrão mantém compat com seus nomes)
const SESSION_MAIN =
  process.env.WPP_SESSION ||
  process.env.WHATSAPP_SESSION ||
  process.env.SESSION ||
  'claudia-main';

// tópico da outbox (um por sessão)
const OUTBOX_TOPIC = process.env.OUTBOX_TOPIC || `outbox:${SESSION_MAIN}`;

// controle de fila (usa seus envs existentes)
const QUEUE_BACKEND = (process.env.QUEUE_BACKEND || 'memory').toLowerCase();
const QUEUE_OUTBOX_CONCURRENCY = Number(process.env.QUEUE_OUTBOX_CONCURRENCY || 4);

// ====== Adapter (factory por sessão) ======
const adapter = makeAdapter({ session: SESSION_MAIN });

// Você pode ligar seu pipeline/flows aqui se quiser
// Ex.: encaminhar toda mensagem recebida para o seu greet/flow.
// Mantive o onMessage simples para não acoplar em nada que você não tenha enviado:
await adapter.onMessage?.(async (msg) => {
  // console.log('[WPP][IN]', msg);
});

// ====== Workers da outbox (consumidores locais) ======
if (QUEUE_BACKEND !== 'none') {
  // Esse worker lê do tópico OUTBOX_TOPIC e executa o envio com o adapter,
  // respeitando min_gap, retries etc. que já existem no seu dispatcher.
  startOutboxWorkers({
    topic: OUTBOX_TOPIC,
    concurrency: QUEUE_OUTBOX_CONCURRENCY,
    // A função abaixo recebe o payload que foi enfileirado em enqueueOutbox
    // e decide como enviar (texto, imagem, etc).
    sendFn: async (job) => {
      const { to, type = 'text', text, imageUrl, caption } = job || {};
      if (!to) throw new Error('Payload inválido: "to" ausente');

      if (type === 'image') {
        return adapter.sendImage?.(to, imageUrl, caption || '');
      }
      return adapter.sendMessage?.(to, text ?? '');
    },
  });
}

// ====== HTTP API ======
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

// Healthcheck do adapter
app.get('/wpp/health', async (req, res) => {
  try {
    const ready = await adapter.isReady?.();
    res.json({
      ok: true,
      ready: !!ready,
      session: SESSION_MAIN,
      backend: QUEUE_BACKEND,
      topic: OUTBOX_TOPIC,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// QR Code (data URL)
app.get('/wpp/qr', async (req, res) => {
  try {
    const dataUrl = await adapter.getQrDataURL?.();
    if (!dataUrl) return res.status(404).json({ ok: false, error: 'QR indisponível' });
    res.json({ ok: true, dataUrl });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Enviar mensagem via OUTBOX (respeita rate-limit/concurrency/retries)
app.post('/wpp/send', async (req, res) => {
  try {
    const { to, text, imageUrl, caption } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, error: '"to" é obrigatório' });

    const payload = imageUrl
      ? { type: 'image', to, imageUrl, caption: caption || '' }
      : { type: 'text', to, text: text ?? '' };

    await enqueueOutbox({
      topic: OUTBOX_TOPIC,
      ...payload,
      meta: { session: SESSION_MAIN },
    });

    res.json({ ok: true, queued: true, topic: OUTBOX_TOPIC });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Envio direto opcional (bypassa a fila): ?sync=1
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

// Boot
app.listen(PORT, () => {
  console.log(
    `[MATRIX-WPP] up on :${PORT} | session=${SESSION_MAIN} | backend=${QUEUE_BACKEND} | topic=${OUTBOX_TOPIC}`
  );
});
