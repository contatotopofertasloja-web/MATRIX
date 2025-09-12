// src/index.js — Matrix IA 2.0 (HTTP + WPP + Outbox/Direct + ASR + TTS + LLM + Promo Admin)
// Core neutro. Filtra JSON do LLM, aplica guardrails de link e suporta áudio end-to-end.

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { adapter, isReady as wppReady, getQrDataURL } from './adapters/whatsapp/index.js';
import { createOutbox } from './core/queue.js';

import { BOT_ID, settings } from './core/settings.js';
import { loadFlows } from './core/flow-loader.js';
import { intentOf } from './core/intent.js';
import { callLLM } from './core/llm.js';
import { getBotHooks } from './core/bot-registry.js';
import { orchestrate } from './core/orchestrator.js';

// ===== ASR (whisper/…)
let transcribeAudio = null;
try {
  const asrMod = await import('./core/asr.js');
  transcribeAudio = asrMod?.transcribeAudio || asrMod?.default || null;
} catch {
  console.warn('[ASR] módulo ausente — áudio será ignorado na entrada.');
}

// ===== TTS (voz/áudio de saída)
let ttsSpeak = null;
try {
  const ttsMod = await import('./core/tts.js');
  ttsSpeak = ttsMod?.synthesizeTTS || ttsMod?.speak || ttsMod?.default || null;
} catch {
  console.warn('[TTS] módulo ausente — respostas por áudio desabilitadas.');
}

// ===== Promoções (sorteio): dynamic import p/ não quebrar caso ausente
let promotions = null;
try {
  const pmod = await import('./core/promotions.js');
  promotions = pmod?.default || pmod;
} catch {
  console.warn('[promotions] módulo ausente — endpoints e enroll seguirão sem erro.');
}

// ===== App/ENV
if (process.env.NODE_ENV !== 'production') {
  try { await import('dotenv/config'); } catch {}
}
const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

const envBool = (v, d=false) =>
  (v==null ? d : ['1','true','yes','y','on'].includes(String(v).trim().toLowerCase()));
const envNum = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// === ENV principais ===
const PORT = envNum(process.env.PORT, 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ADAPTER_NAME = String(process.env.WPP_ADAPTER || 'baileys');
const OPS_TOKEN = process.env.OPS_TOKEN || process.env.ADMIN_TOKEN || '';

const ECHO_MODE = envBool(process.env.ECHO_MODE, false);
let intakeEnabled = envBool(process.env.INTAKE_ENABLED, true);
let sendEnabled = envBool(process.env.SEND_ENABLED, true);
let DIRECT_SEND = envBool(process.env.DIRECT_SEND, true);

// Redis / Outbox
const REDIS_MAIN_URL = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';
const OUTBOX_TOPIC = process.env.OUTBOX_TOPIC || `outbox:${process.env.WPP_SESSION || 'default'}`;
const OUTBOX_CONCURRENCY = envNum(process.env.QUEUE_OUTBOX_CONCURRENCY, 1);

const outbox = await createOutbox({
  topic: OUTBOX_TOPIC,
  concurrency: OUTBOX_CONCURRENCY,
  redisUrl: REDIS_MAIN_URL,
});

// ==== Auth de operações admin (promo/export/draw/logs)
function requireOpsAuth(req, res, next) {
  const token = req.get('X-Ops-Token') || (req.query?.token ?? '');
  if (!OPS_TOKEN) return res.status(403).json({ ok: false, error: 'OPS_TOKEN unset' });
  if (String(token) !== String(OPS_TOKEN)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}

// =================== Helpers de envio ===================
async function sendViaAdapter(to, kind, payload) {
  if (!to || !sendEnabled) return;
  if (kind === 'image') {
    const url = payload?.url;
    const caption = (payload?.caption || '').toString();
    if (url) await adapter.sendImage(to, url, caption);
    return;
  }
  if (kind === 'audio') {
    const buf = payload?.buffer;
    const mime = payload?.mime || 'audio/ogg';
    if (buf && typeof adapter?.sendAudio === 'function') {
      await adapter.sendAudio(to, buf, { mime, ptt: true });
      return;
    }
    if (buf && typeof adapter?.sendVoice === 'function') {
      await adapter.sendVoice(to, buf, { mime });
      return;
    }
    const fallbackText = (payload?.fallbackText || '').toString();
    if (fallbackText) await adapter.sendMessage(to, { text: fallbackText });
    return;
  }
  const text = String(payload?.text || '');
  if (text) await adapter.sendMessage(to, { text });
}

async function enqueueOrDirect({ to, kind = 'text', payload = {} }) {
  try {
    if (DIRECT_SEND || !outbox.isConnected()) {
      await sendViaAdapter(to, kind, payload);
      return { path: 'direct' };
    }
    await outbox.publish({ to, kind, payload });
    return { path: 'outbox' };
  } catch {
    await sendViaAdapter(to, kind, payload);
    return { path: 'direct-fallback' };
  }
}

await outbox.start(async (job) => {
  const { to, kind = 'text', payload = {} } = job || {};
  await sendViaAdapter(to, kind, payload);
});

// =================== Flows/Hooks ===================
const flows = await loadFlows(BOT_ID);
const hooks = await getBotHooks();
const sentOpening = new Set();

// =================== ASR helpers ===================
async function tryGetAudioBuffer(raw) {
  try {
    if (typeof adapter?.getAudioBuffer === 'function') return await adapter.getAudioBuffer(raw);
    if (typeof adapter?.downloadMedia === 'function') return await adapter.downloadMedia(raw, { audioOnly: true });
    return null;
  } catch (e) {
    console.warn('[ASR] tryGetAudioBuffer:', e?.message || e);
    return null;
  }
}
async function transcribeIfPossible(buf, mime = 'audio/ogg') {
  if (!buf || typeof transcribeAudio !== 'function') return null;
  try {
    return await transcribeAudio({
      buffer: buf,
      mimeType: mime,
      provider: settings?.audio?.asrProvider || 'openai',
      model: settings?.audio?.asrModel || 'whisper-1',
      language: settings?.audio?.language || 'pt',
    });
  } catch (e) {
    console.warn('[ASR] transcribeIfPossible:', e?.message || e);
    return null;
  }
}
function isAudioMessage(raw) {
  try { return !!raw?.message?.audioMessage; } catch { return false; }
}

// =================== TTS helpers ===================
async function ttsIfPossible(text) {
  if (!text || typeof ttsSpeak !== 'function') return null;
  try {
    const voice = settings?.audio?.ttsVoice || 'alloy';
    const lang  = settings?.audio?.language || 'pt';
    const out = await ttsSpeak({ text, voice, language: lang, format: 'ogg' });
    if (out?.buffer?.byteLength) return { buffer: out.buffer, mime: out.mime || 'audio/ogg' };
  } catch (e) {
    console.warn('[TTS] synth fail:', e?.message || e);
  }
  return null;
}

// =================== Guardrails / JSON filter ===================
function get(obj, path) {
  return String(path || '')
    .split('.')
    .reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
}
function expandTemplates(str, ctx) {
  return String(str || '').replace(/{{\s*([^}]+)\s*}}/g, (_, p) => {
    const v = get(ctx, p.trim());
    return v == null ? '' : String(v);
  });
}
function allowedLinksFromSettings() {
  const raw = settings?.guardrails?.allowed_links || [];
  const ctx = { ...settings, product: settings?.product || {}, sweepstakes: settings?.sweepstakes || {} };
  return (Array.isArray(raw) ? raw : [])
    .map((u) => expandTemplates(u, ctx))
    .filter((u) => typeof u === 'string' && u.trim().startsWith('http'));
}
function sanitizeLinks(text) {
  const allow = new Set(allowedLinksFromSettings());
  return String(text || '').replace(/https?:\/\/\S+/gi, (url) => {
    return allow.has(url) ? url : '[link removido]';
  });
}
function stripCodeFences(s='') {
  const t = String(s).trim();
  if (t.startsWith('```')) {
    const inner = t.replace(/^```[a-zA-Z0-9]*\s*/,'').replace(/```$/,'').trim();
    return inner;
  }
  return t;
}
function parseJSONSafe(s) {
  try { return JSON.parse(stripCodeFences(s)); } catch { return null; }
}
function extractReplyAndMeta(outText) {
  const parsed = parseJSONSafe(outText);
  if (parsed && typeof parsed === 'object' && parsed.reply) {
    return {
      reply: String(parsed.reply || '').trim(),
      stage: parsed.stage || '',
      slots: parsed.slots || {},
      tool_calls: parsed.tool_calls || [],
      raw: parsed,
    };
  }
  return { reply: String(outText || '').trim(), stage: '', slots: {}, tool_calls: [], raw: null };
}
function prepareOutboundText(llmOut) {
  const { reply } = extractReplyAndMeta(llmOut);
  return sanitizeLinks(reply);
}

// =================== Entrega unificada (texto + opcional áudio) ===================
async function deliverReply({ to, text, wantAudio = false }) {
  const cleanText = prepareOutboundText(text);
  if (wantAudio && settings?.flags?.allow_audio_out !== false) {
    const audio = await ttsIfPossible(cleanText);
    if (audio?.buffer) {
      await enqueueOrDirect({
        to,
        kind: 'audio',
        payload: { buffer: audio.buffer, mime: audio.mime, fallbackText: cleanText },
      });
    }
  }
  await enqueueOrDirect({ to, payload: { text: cleanText } });
}

// =================== Handler principal ===================
adapter.onMessage(async ({ from, text, hasMedia, raw }) => {
  if (!intakeEnabled) return '';
  try {
    // mídia de abertura (1x por contato)
    if (!sentOpening.has(from)) {
      const media = await hooks.openingMedia({ settings });
      if (media?.url) {
        await enqueueOrDirect({
          to: from,
          kind: 'image',
          payload: { url: media.url, caption: media.caption || '' },
        });
      }
      sentOpening.add(from);
    }

    // echo
    if (ECHO_MODE && text) {
      await enqueueOrDirect({ to: from, payload: { text: `Echo: ${text}` } });
      return '';
    }

    // texto base (ou ASR p/ áudio)
    let msgText = (text || '').trim();
    const incomingIsAudio = isAudioMessage(raw);
    if (hasMedia && !msgText && incomingIsAudio) {
      const buf = await tryGetAudioBuffer(raw);
      const asr = buf ? await transcribeIfPossible(buf) : null;
      if (asr && asr.trim()) msgText = asr.trim();
    }
    if (!msgText) return '';

    // webhook-like por texto (pós-venda)
    if (/(\bpaguei\b|\bpagamento\s*feito\b|\bcomprovante\b|\bfinalizei\b)/i.test(msgText)) {
      await hooks.onPaymentConfirmed({
        jid: from,
        settings,
        send: async (to, t) => enqueueOrDirect({ to, payload: { text: t } }),
      });
      return '';
    }

    // Orquestrador LLM (primeiro)
    let reply = '';
    try {
      const intent = intentOf(msgText) || 'qualify';
      reply = await orchestrate({ jid: from, text: msgText, stageHint: intent, botSettings: settings });
    } catch (e) {
      console.warn('[orchestrator] erro:', e?.message || e);
    }

    if (reply && reply.trim()) {
      await deliverReply({ to: from, text: reply, wantAudio: incomingIsAudio });
      return '';
    }

    // Fallback — flows determinísticos
    let flowObj = null;
    try { if (typeof flows?.__route === 'function') flowObj = flows.__route(msgText, settings, from); } catch {}
    if (!flowObj) flowObj = flows?.[intentOf(msgText) || 'greet'];

    if (flowObj?.run) {
      const send = async (to, t) => deliverReply({ to, text: String(t || ''), wantAudio: incomingIsAudio });
      await flowObj.run({ jid: from, text: msgText, settings, send });
      return '';
    }

    // Fallback final LLM "texto solto"
    const { system, user } = await hooks.safeBuildPrompt({ stage: 'qualify', message: msgText, settings });
    const { text: fb } = await callLLM({ stage: 'qualify', system, prompt: user });
    await deliverReply({
      to: from,
      text: fb || 'Posso te explicar rapidamente como funciona e o valor?',
      wantAudio: incomingIsAudio,
    });
    return '';
  } catch (e) {
    console.error('[onMessage]', e);
    const fb = await hooks.fallbackText({ stage: 'error', message: text || '', settings });
    await enqueueOrDirect({ to: from, payload: { text: prepareOutboundText(fb) } });
    return '';
  }
});

// =================== Rotas HTTP ===================
const limiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Matrix IA 2.0',
    bot: BOT_ID,
    adapter: ADAPTER_NAME,
    ready: wppReady(),
    env: process.env.NODE_ENV || 'production',
    ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND },
  });
});

app.get('/wpp/health', (_req, res) => {
  res.json({
    ok: true,
    ready: wppReady(),
    adapter: ADAPTER_NAME,
    session: process.env.WPP_SESSION || 'default',
    backend: outbox.backend(),
    topic: OUTBOX_TOPIC,
    concurrency: OUTBOX_CONCURRENCY,
    ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND },
    redis: { url: REDIS_MAIN_URL ? 'set' : 'unset', connected: outbox.isConnected() },
  });
});

app.get('/wpp/qr', async (req, res) => {
  try {
    const dataURL = await getQrDataURL();
    if (!dataURL) return res.status(204).end();
    const view = (req.query.view || '').toString();
    if (view === 'img') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`<!doctype html><html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0b12;color:#fff"><img src="${dataURL}" width="320" height="320"/></body></html>`);
    }
    if (view === 'png') {
      const b64 = dataURL.split(',')[1];
      const buf = Buffer.from(b64, 'base64');
      res.setHeader('Content-Type', 'image/png');
      return res.send(buf);
    }
    res.json({ ok: true, qr: dataURL, bot: BOT_ID, adapter: ADAPTER_NAME });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get('/qr', (_req, res) => res.redirect(302, '/wpp/qr?view=img'));

app.get('/ops/mode', (req, res) => {
  const set = (req.query.set || '').toString().toLowerCase();
  if (set === 'direct') DIRECT_SEND = true;
  if (set === 'outbox') DIRECT_SEND = false;
  res.json({ ok: true, direct_send: DIRECT_SEND, backend: outbox.backend() });
});

app.get('/ops/status', (_req, res) => {
  res.json({ ok: true, intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND });
});

app.post('/wpp/send', limiter, async (req, res) => {
  try {
    const { to, text, imageUrl, caption } = req.body || {};
    if (!to || (!text && !imageUrl)) {
      return res.status(400).json({ ok: false, error: 'Informe { to, text } ou { to, imageUrl }' });
    }
    if (imageUrl) await enqueueOrDirect({ to, kind: 'image', payload: { url: imageUrl, caption: caption || '' } });
    if (text) await enqueueOrDirect({ to, payload: { text: prepareOutboundText(text) } });
    res.json({ ok: true, enqueued: true, path: DIRECT_SEND ? 'direct' : 'outbox' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ===== Webhook de pagamento + inscrição em promoções =====
app.post('/webhook/payment', async (req, res) => {
  try {
    const headerToken = req.get('X-Webhook-Token');
    const bodyToken = (req.body && req.body.token) || '';
    const tokenOk = (headerToken && headerToken === process.env.WEBHOOK_TOKEN) || (bodyToken === process.env.WEBHOOK_TOKEN);
    if (!tokenOk) return res.status(401).json({ ok: false, error: 'invalid token' });

    const { to, status, order_id, delivered_at, buyer } = req.body || {};
    const normalizedStatus = String(status || '').toLowerCase();
    const eligible = normalizedStatus === 'paid' || normalizedStatus === 'delivered';

    if (eligible && to && order_id) {
      if (promotions && typeof promotions.enroll === 'function') {
        promotions.enroll({
          jid: String(to),
          order_id: String(order_id),
          status: normalizedStatus,
          delivered_at: delivered_at || null,
          extra: { buyer: buyer || null }
        });
      }

      await hooks.onPaymentConfirmed({
        jid: String(to),
        settings,
        send: async (jid, text) => enqueueOrDirect({ to: jid, payload: { text: prepareOutboundText(text) } }),
      });
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ===== Endpoints Admin de Promoções =====
app.get('/ops/promo/export', requireOpsAuth, (req, res) => {
  try {
    const month = (req.query?.month || '').toString() || undefined; // YYYY-MM ou mês corrente
    if (!promotions || typeof promotions.exportMonth !== 'function') {
      return res.status(501).json({ ok: false, error: 'promotions module not installed' });
    }
    const r = promotions.exportMonth(month);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/ops/promo/draw', requireOpsAuth, (req, res) => {
  try {
    const month = (req.body?.month || req.query?.month || '').toString() || undefined;
    const n = Number(req.body?.n || req.query?.n || 3);
    if (!promotions || typeof promotions.drawWinners !== 'function') {
      return res.status(501).json({ ok: false, error: 'promotions module not installed' });
    }
    const r = promotions.drawWinners(month, n);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get('/ops/promo/months', requireOpsAuth, (req, res) => {
  try {
    if (!promotions || typeof promotions.monthsAvailable !== 'function') {
      return res.status(501).json({ ok: false, error: 'promotions module not installed' });
    }
    const months = promotions.monthsAvailable();
    const stats = months.map(m => promotions.monthStats(m));
    res.json({ ok: true, months, stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get('/ops/promo/logs', requireOpsAuth, (req, res) => {
  try {
    const n = Number(req.query?.n || 200);
    const grep = (req.query?.grep || '').toString();
    const month = (req.query?.month || '').toString();
    if (!promotions || typeof promotions.tailLog !== 'function') {
      return res.status(501).json({ ok: false, error: 'promotions module not installed' });
    }
    const r = promotions.tailLog({ n, grep, month });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/inbound', async (req, res) => {
  try {
    const { to, text } = req.body || {};
    const jid = String(to || '').trim();
    const msg = String(text || '').trim();
    if (!jid || !msg) return res.status(400).json({ ok: false, error: 'Informe { to, text }' });
    await enqueueOrDirect({ to: jid, payload: { text: prepareOutboundText(msg) } });
    res.json({ ok: true, enqueued: true, path: DIRECT_SEND ? 'direct' : 'outbox' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[HTTP] Matrix bot (${BOT_ID}) on http://${HOST}:${PORT}`);
});

function gracefulClose(signal) {
  console.log(`[shutdown] signal=${signal}`);
  server?.close?.(() => console.log('[http] closed'));
  try { adapter?.close?.(); } catch {}
  try { outbox?.stop?.(); } catch {}
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', () => gracefulClose('SIGINT'));
process.on('SIGTERM', () => gracefulClose('SIGTERM'));
