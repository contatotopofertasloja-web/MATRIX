// src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';

// WhatsApp adapter (escolhido por WPP_ADAPTER=baileys|meta)
import { adapter, isReady as wppReady, getQrDataURL } from './adapters/whatsapp/index.js';

// Core (configs, flows e NLU leve)
import { BOT_ID } from './core/settings.js';
import { loadFlows } from './core/flow-loader.js';
import { intentOf } from './core/intent.js';

// Opcional: util do Baileys para baixar áudio do raw message
// (não requer mudanças no adapter)
import { downloadContentFromMessage } from '@whiskeysockets/baileys';

// ---------------------------------------------------------
// App base
// ---------------------------------------------------------
const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

// ---------------------------------------------------------
// Flags/ENV
// ---------------------------------------------------------
const ADAPTER_NAME = String(process.env.WPP_ADAPTER || 'baileys');
const ECHO_MODE = String(process.env.ECHO_MODE || 'false').toLowerCase() === 'true';

// OpenAI (Whisper + LLM se quiser evoluir depois)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Rate limit só nas rotas sensíveis
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------------------------------------------------------
// Flows do BOT
// (compatível com src/bots/<bot>/flows ou configs/bots/<bot>/flow)
// ---------------------------------------------------------
const flows = await loadFlows(BOT_ID);

// ---------------------------------------------------------
// Auxiliar: baixa e transcreve áudio do raw message (Baileys)
// ---------------------------------------------------------
async function transcribeFromRaw(raw) {
  try {
    const a =
      raw?.message?.audioMessage ||
      raw?.message?.voiceMessage || // algumas builds
      raw?.message?.pttMessage;     // alias raro

    if (!a) return null;

    // baixa o stream de áudio com o Baileys
    const stream = await downloadContentFromMessage(a, 'audio');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    // chama Whisper (OpenAI)
    // nome do arquivo é apenas informativo
    const file = new File([buffer], 'audio.ogg', { type: 'audio/ogg' });
    const res = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      // language: 'pt', // opcional; Whisper detecta idioma
    });

    const text = (res?.text || '').trim();
    return text || null;
  } catch (e) {
    console.error('[audio][transcribe][error]', e);
    return null;
  }
}

// ---------------------------------------------------------
// Pipeline: mensagens recebidas do WhatsApp
// - texto: roteia direto
// - áudio: transcreve → roteia como texto
// ---------------------------------------------------------
adapter.onMessage(async ({ from, text, hasMedia, raw }) => {
  try {
    // 1) ECHO rápido (debug)
    if (ECHO_MODE && (text?.trim() || '')) return `Echo: ${text}`;

    // 2) Se não há texto mas tem áudio, tenta transcrever
    let msgText = (text || '').trim();
    if (!msgText && hasMedia && raw) {
      const transcript = await transcribeFromRaw(raw);
      if (transcript) msgText = transcript;
    }

    // 3) Nada pra dizer? evita SPAM
    if (!msgText) return '';

    // 4) Intenção e roteamento
    const intent = intentOf(msgText);
    const handler =
      flows[intent] ||
      flows[intent?.toLowerCase?.()] ||
      null;

    // 5) Executa flow específico
    if (typeof handler === 'function') {
      const reply = await handler({
        userId: from,
        text: msgText,
        context: { hasMedia, raw, cameFromAudio: (!!text ? false : true) },
      });
      return typeof reply === 'string' ? reply : '';
    }

    // 6) Defaults úteis (fallback)
    switch (intent) {
      case 'delivery':
        return 'Me passa seu CEP rapidinho que já te confirmo prazo e frete 🚚';
      case 'payment':
        return 'Temos Pagamento na Entrega (COD). Se preferir, posso te passar outras opções também.';
      case 'features':
        return 'É um tratamento sem formol que alinha e nutre. Quer o passo a passo de uso?';
      case 'objection':
        return 'Te entendo! É produto regularizado, com garantia e suporte. Posso te enviar resultados e modo de uso?';
      case 'offer':
        return 'Consigo te fazer uma condição especial hoje. Quer que eu te explique? 😉';
      case 'close':
        return 'Posso te mandar o link do checkout pra garantir o valor agora?';
      default:
        return 'Consegue me contar rapidinho como é seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?)';
    }
  } catch (e) {
    console.error('[onMessage][error]', e);
    return 'Dei uma travadinha aqui, pode repetir? 💕';
  }
});

// ---------------------------------------------------------
// Rotas HTTP
// ---------------------------------------------------------
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
  res.json({ ok: true, ready: wppReady(), adapter: ADAPTER_NAME, session: process.env.WPP_SESSION });
});

// QR em DataURL (para UI/admin)
// - 204 se ainda não gerou (ou já conectou)
// - 200 { qr: "data:image/png;base64,..." }
app.get('/wpp/qr', async (_req, res) => {
  try {
    const dataURL = await getQrDataURL();
    if (!dataURL) return res.status(204).end();
    res.json({ qr: dataURL, adapter: ADAPTER_NAME, bot: BOT_ID });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Envio manual (teste) — protegido com rate limit
app.post('/wpp/send', sendLimiter, async (req, res) => {
  try {
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ ok: false, error: 'Informe { to, text }' });
    await adapter.sendMessage(to, text);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---------------------------------------------------------
// Boot HTTP
// ---------------------------------------------------------
app.listen(PORT, HOST, () => {
  console.log(`[server] Matrix on http://${HOST}:${PORT} — adapter=${ADAPTER_NAME} bot=${BOT_ID}`);
});
