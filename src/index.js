// src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import rateLimit from './middlewares/rateLimit.js';
import { adapter, getQrDataURL, isReady } from './index-gpt.js'; // Baileys adapter
import { bot } from './bot.js';
import { settings } from './core/settings.js';

// 🚀 Fila pesada (dispatcher plugável: memory | redis | sqs | rabbit)
import { startQueues, dispatchMessage } from './queue/dispatcher.js';

// Opcional: polimento (máx. frases/emojis)
// import { limitSentencesEmojis } from './utils/polish.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// Protege o /webhook com rate limit + token, se WEBHOOK_TOKEN estiver setado
app.use('/webhook', rateLimit);

// 🔌 Liga as filas (outbox/inbox conforme backend escolhido por ENV)
startQueues();

// ========== WhatsApp → Matrix (FSM/flows) ==========
adapter.onMessage(async ({ from, text, hasMedia }) => {
  if (!text && !hasMedia) return;

  try {
    // 1) roda a FSM (intents/flows) e obtém a resposta
    let reply = await bot.handleMessage({ userId: from, text, context: { hasMedia } });

    // 2) (opcional) polimento de estilo
    // reply = limitSentencesEmojis(
    //   reply,
    //   settings?.limits?.max_sentences ?? 2,
    //   settings?.limits?.max_emojis ?? 2
    // );

    // 3) Regra Matrix: se flag ativa e houver '\n', enviar como múltiplas mensagens
    const splitAllowed = Boolean(settings?.flags?.send_link_in_two_messages);
    if (splitAllowed && typeof reply === 'string' && reply.includes('\n')) {
      const parts = reply.split('\n').map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        await dispatchMessage(from, part);   // <-- usa fila
      }
      return; // evita duplicidade
    }

    // 4) Caso normal → enfileira envio
    if (typeof reply === 'string' && reply.trim()) {
      await dispatchMessage(from, reply);     // <-- usa fila
    }
  } catch (e) {
    console.error('[BOT][ERR]', e);
    try { await dispatchMessage(from, 'Dei uma travadinha aqui, pode repetir? 💕'); } catch {}
  }
});

// ========== Rotas utilitárias ==========
app.get('/wpp/health', (_req, res) => {
  res.json({ ok: true, ready: isReady() });
});

app.get('/wpp/qr', async (_req, res) => {
  const dataUrl = await getQrDataURL();
  if (!dataUrl) {
    return res
      .status(200)
      .send(isReady() ? '✅ Conectado' : 'Aguardando QR... atualize em alguns segundos.');
  }
  res.status(200).send(`
    <html>
      <body style="display:grid;place-items:center;height:100vh;font-family:sans-serif">
        <div>
          <h3>Escaneie no WhatsApp</h3>
          <img src="${dataUrl}" alt="QR WhatsApp" />
        </div>
      </body>
    </html>
  `);
});

// Webhook de teste (envio manual de mensagem)
app.post('/webhook', async (req, res) => {
  try {
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ ok: false, error: 'to e text são obrigatórios' });
    await dispatchMessage(String(to), String(text));   // <-- usa fila
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ========== Start ==========
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`[HTTP] Matrix rodando em http://${HOST}:${PORT}`);
});
