// src/index.js — Matrix IA 2.0 (Cláudia) — HTTP + WPP + Outbox (Redis) + ASR (Whisper)
// Baseado no seu arquivo enviado (mantém rotas/ops/leader/queue).
// Acrescentado: transcrição de áudio (Whisper) + roteamento flows/LLM usando texto transcrito.
// (c) Matrix IA 2.0

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import Redis from 'ioredis';

import { adapter, isReady as wppReady, getQrDataURL } from './adapters/whatsapp/index.js';
import { createOutbox } from './core/queue.js';

import { BOT_ID } from './core/settings.js';
import { loadFlows } from './core/flow-loader.js';
import { intentOf } from './core/intent.js';
import { isCanaryUser, CANARY_FLOW_KEY } from './core/canary.js';

// LLM + prompts + settings
import { callLLM } from './core/llm.js';
import { settings } from './core/settings.js';
import { buildPrompt } from '../configs/bots/claudia/prompts/index.js';

// 🔊 ASR (transcrição)
let transcribeAudio = null;
try {
  const asrMod = await import('./core/asr.js');
  transcribeAudio = asrMod?.transcribeAudio || asrMod?.default || null;
} catch {
  console.warn('[ASR] Módulo ./core/asr.js ausente — áudio será ignorado.');
}

// Carrega .env em dev
if (process.env.NODE_ENV !== 'production') {
  try { await import('dotenv/config'); } catch {}
}

// Alertas (mantidos)
import { notifyDown } from './alerts/notifier.js';

// (Opcional) Canary Gate — se existir, aplicamos
let canaryGate = null;
try {
  const mod = await import('./middlewares/canaryGate.js');
  canaryGate = mod?.default || mod?.canaryGate || null;
} catch { /* ignore if missing */ }

// (Opcional) Heartbeat watcher — agora **opcional** (não quebra se ausente)
let startHeartbeatWatcher = null;
try {
  const mod = await import('./watchers/heartbeat.js');
  startHeartbeatWatcher = mod?.startHeartbeatWatcher || mod?.default || null;
} catch { /* ignore if missing */ }

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

// Helpers ENV
const envBool = (v, d = false) => {
  if (v === undefined || v === null) return d;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'y' || s === 'yes' || s === 'on';
};
const envNum = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// Configs básicas
const PORT = envNum(process.env.PORT, 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ADAPTER_NAME = String(process.env.WPP_ADAPTER || 'baileys');
const ECHO_MODE = envBool(process.env.ECHO_MODE, false);
const INSTANCE_ID = process.env.INSTANCE_ID || process.env.WPP_SESSION || 'instance-1';

// Flags mutáveis (publicadas em /wpp/health e /ops/status)
let intakeEnabled = envBool(process.env.INTAKE_ENABLED, true);
let sendEnabled   = envBool(process.env.SEND_ENABLED,   true);

// Redis principal (prioriza MATRIX_REDIS_URL)
const REDIS_MAIN_URL = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';
const useTLS = REDIS_MAIN_URL.startsWith('rediss://');
const redisOpts = {
  lazyConnect: false,
  enableReadyCheck: true,
  connectTimeout: 8000,
  keepAlive: 15000,
  maxRetriesPerRequest: null,
  autoResubscribe: true,
  autoResendUnfulfilledCommands: true,
  retryStrategy: (times) => Math.min(30000, 1000 + times * 500),
  reconnectOnError: (err) => {
    const code = err?.code || '';
    const msg  = String(err?.message || '');
    return (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT' || msg.includes('READONLY'));
  },
  tls: useTLS ? { rejectUnauthorized: false } : undefined,
};

// Fila Outbox
const OUTBOX_TOPIC = process.env.OUTBOX_TOPIC || `outbox:${process.env.WPP_SESSION || 'default'}`;
const OUTBOX_CONCURRENCY = envNum(process.env.QUEUE_OUTBOX_CONCURRENCY, 4);

const outbox = await createOutbox({
  topic: OUTBOX_TOPIC,
  concurrency: OUTBOX_CONCURRENCY,
  redisUrl: REDIS_MAIN_URL,
});

// Consumer: envia via adapter (respeita sendEnabled)
await outbox.start(async (job) => {
  const { to, kind = 'text', payload = {} } = job || {};
  if (!to) return;

  if (!sendEnabled) {
    console.log('[outbox] SEND_DISABLED — drop job', { to, kind });
    return;
  }

  if (kind === 'image') {
    const { url, caption = '' } = payload || {};
    if (url) await adapter.sendImage(to, url, caption);
    return;
  }

  const text = String(payload?.text || '');
  if (text) await adapter.sendMessage(to, text);
});

// Flows (mantidos p/ canário)
const flows = await loadFlows(BOT_ID);

// Controle de "foto de abertura"
const sentOpening = new Set(); // memória por processo é suficiente pro canário

// Pós-pagamento (mensagens + cupom, se habilitado)
async function handlePaymentConfirmed(jid) {
  try {
    for (const line of settings.messages?.postsale_pre_coupon ?? []) {
      await outbox.publish({ to: jid, kind: 'text', payload: { text: line } });
    }
    if (settings.product?.coupon_post_payment_only && settings.product?.coupon_code) {
      const msgTpl = settings.messages?.postsale_after_payment_with_coupon?.[0] || '';
      const msg = msgTpl.replace('{{coupon_code}}', settings.product.coupon_code);
      if (msg) await outbox.publish({ to: jid, kind: 'text', payload: { text: msg } });
    }
  } catch (e) {
    console.error('[payment][confirm][error]', e);
  }
}

// ---------- Helpers de mídia/áudio ----------

// Tenta extrair um buffer de áudio a partir do objeto raw do adapter.
// Prioriza métodos expostos pelo adapter; se ausentes, retorna null (segue só texto).
async function tryGetAudioBuffer(raw) {
  try {
    // Se o adapter expuser um util direto:
    if (typeof adapter?.getAudioBuffer === 'function') {
      return await adapter.getAudioBuffer(raw);
    }
    if (typeof adapter?.downloadMedia === 'function') {
      // alguns adapters expõem downloadMedia(raw, {audioOnly:true})
      return await adapter.downloadMedia(raw, { audioOnly: true });
    }

    // Fallback leve: detectar se a mensagem parece ter áudio
    const m = raw?.message || raw?.msg || null;
    const hasAudio =
      !!m?.audioMessage ||
      !!m?.voiceMessage ||
      !!m?.ptt ||
      !!m?.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage;
    if (!hasAudio) return null;

    console.warn('[ASR] Adapter não expõe getAudioBuffer/downloadMedia — áudio detectado, mas sem como baixar.');
    return null;
  } catch (e) {
    console.warn('[ASR] tryGetAudioBuffer error:', e?.message || e);
    return null;
  }
}

// Transcreve buffer usando o módulo ./core/asr.js (Whisper por padrão)
async function transcribeIfPossible(buf, mimeGuess = 'audio/ogg') {
  if (!buf || typeof transcribeAudio !== 'function') return null;
  try {
    return await transcribeAudio({
      buffer: buf,
      mimeType: mimeGuess,
      provider: settings?.audio?.asrProvider || 'openai',
      model: settings?.audio?.asrModel || 'whisper-1',
      language: settings?.audio?.language || 'pt',
    });
  } catch (e) {
    console.warn('[ASR] transcribeIfPossible error:', e?.message || e);
    return null;
  }
}

// Entrada WhatsApp (LLM + canário + foto de abertura + ÁUDIO→ASR)
adapter.onMessage(async ({ from, text, hasMedia, raw }) => {
  if (!intakeEnabled) {
    console.log('[intake] INTAKE_DISABLED — ignoring incoming', { from });
    return '';
  }

  // Se existir canaryGate, usamos como "valvulinha" (não bloqueia se ausente)
  if (canaryGate) {
    const gateOk = await canaryGate.tryPass({ from, text, hasMedia });
    if (!gateOk) return '';
  }

  try {
    // 0) Foto de abertura (apenas 1x por contato)
    if (settings.flags?.send_opening_photo && !sentOpening.has(from) && settings.media?.opening_photo_url) {
      await outbox.publish({
        to: from,
        kind: 'image',
        payload: { url: settings.media.opening_photo_url, caption: '' },
      });
      sentOpening.add(from);
    }

    // 1) ECHO (debug)
    if (ECHO_MODE && text) {
      await outbox.publish({ to: from, kind: 'text', payload: { text: `Echo: ${text}` } });
      return '';
    }

    // 2) Texto base
    let msgText = (text || '').trim();

    // 3) Se vier mídia, tentamos extrair/transcrever ÁUDIO
    if (hasMedia && !msgText) {
      const audioBuf = await tryGetAudioBuffer(raw);
      if (audioBuf?.length) {
        const asr = await transcribeIfPossible(audioBuf);
        if (asr && asr.trim()) msgText = asr.trim();
      }
    }

    // 4) Ignora vazios absolutos
    if (!msgText) return '';

    // 5) Confirmação de pagamento (texto)
    if (/(\bpaguei\b|\bpagamento\s*feito\b|\bcomprovante\b|\bfinalizei\b)/i.test(msgText)) {
      await handlePaymentConfirmed(from);
      return '';
    }

    // 6) CANÁRIO (se existir flow canário, usa ele)
    const useCanary = isCanaryUser(from);
    if (useCanary && typeof flows[CANARY_FLOW_KEY] === 'function') {
      const reply = await flows[CANARY_FLOW_KEY]({ userId: from, text: msgText, context: { hasMedia, raw } });
      if (typeof reply === 'string' && reply.trim()) {
        await outbox.publish({ to: from, kind: 'text', payload: { text: reply } });
      }
      return '';
    }

    // 7) Roteia intenção → prompt por etapa → LLM
    const intent = intentOf(msgText) || 'greet';
    const { system, user } = buildPrompt({ stage: intent, message: msgText });
    const { text: reply } = await callLLM({ stage: intent, system, prompt: user });

    if (reply && reply.trim()) {
      await outbox.publish({ to: from, kind: 'text', payload: { text: reply } });
      return '';
    }

    // 8) Fallback simpático
    await outbox.publish({
      to: from,
      kind: 'text',
      payload: { text: 'Consegue me contar rapidinho sobre seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?)' },
    });
    return '';
  } catch (e) {
    console.error('[onMessage][error]', e);
    await outbox.publish({ to: from, kind: 'text', payload: { text: 'Dei uma travadinha aqui, pode repetir? 💕' } });
    return '';
  }
});

// Limiters HTTP
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Rotas básicas
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Matrix IA 2.0',
    bot: BOT_ID,
    adapter: ADAPTER_NAME,
    ready: wppReady(),
    env: process.env.NODE_ENV || 'production',
    ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled },
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
    ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled },
    redis: { url: REDIS_MAIN_URL ? 'set' : 'unset', connected: outbox.isConnected() },
  });
});

// QR (?view=img|png) ou JSON
app.get('/wpp/qr', async (req, res) => {
  try {
    const dataURL = await getQrDataURL();
    if (!dataURL) return res.status(204).end();

    const view = (req.query.view || '').toString();
    if (view === 'img') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>QR</title></head>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0b12;color:#fff;font-family:system-ui">
  <div style="text-align:center">
    <img src="${dataURL}" alt="WhatsApp QR" style="image-rendering:pixelated;width:320px;height:320px;border-radius:12px;box-shadow:0 0 40px #0006"/>
    <p style="opacity:.7">Atualize a página para gerar um QR novo se expirar.</p>
  </div>
</body></html>`);
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

// Alias simples → redireciona para a view em HTML do QR
app.get('/qr', (_req, res) => res.redirect(302, '/wpp/qr?view=img'));

// Ops/status (inclui flags e liderança)
let isLeader = false;
app.get('/ops/status', (_req, res) => {
  res.json({
    ok: true,
    intake_enabled: intakeEnabled,
    send_enabled: sendEnabled,
    is_leader: isLeader,
    session: process.env.WPP_SESSION || 'default',
    instance_id: INSTANCE_ID,
  });
});

// Envio manual
app.post('/wpp/send', sendLimiter, async (req, res) => {
  try {
    const { to, text, imageUrl, caption } = req.body || {};
    if (!to || (!text && !imageUrl)) {
      return res.status(400).json({ ok: false, error: 'Informe { to, text } ou { to, imageUrl }' });
    }
    if (!sendEnabled) {
      return res.status(202).json({ ok: true, enqueued: false, note: 'SEND_DISABLED — instância silenciosa' });
    }
    if (imageUrl) await outbox.publish({ to, kind: 'image', payload: { url: imageUrl, caption: caption || '' } });
    if (text)     await outbox.publish({ to, kind: 'text',  payload: { text } });
    res.json({ ok: true, enqueued: true });
  } catch (e) {
    console.error('[POST /wpp/send][error]', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ✅ Webhook simples p/ confirmação de pagamento (opcional)
app.post('/webhook/payment', async (req, res) => {
  try {
    const { token, to, status } = req.body || {};
    if (token !== process.env.WEBHOOK_TOKEN) return res.status(401).end();
    if (String(status).toLowerCase() === 'paid' && to) {
      await handlePaymentConfirmed(String(to));
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[webhook/payment][error]', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 🔹 Inbound genérico (injeção de mensagens — útil p/ testes / integrações)
app.post('/inbound', async (req, res) => {
  try {
    const { to, text } = req.body || {};
    const jid = String(to || '').trim();
    const msg = String(text || '').trim();
    if (!jid || !msg) return res.status(400).json({ ok: false, error: 'Informe { to, text }' });
    if (!sendEnabled) {
      return res.status(202).json({ ok: true, enqueued: false, note: 'SEND_DISABLED — instância silenciosa' });
    }
    await outbox.publish({ to: jid, kind: 'text', payload: { text: msg } });
    res.json({ ok: true, enqueued: true });
  } catch (e) {
    console.error('[POST /inbound][error]', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 🔸 Novo: teste de alerta por HTTP (opcional)
app.post('/ops/test-alert', async (req, res) => {
  try {
    const reason = req.body?.reason || 'teste manual';
    const meta   = req.body?.meta   || { source: '/ops/test-alert' };
    await notifyDown({ reason, meta });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// --------- Leader Election + Auto-demote ---------
const LEADER_ELECTION_ENABLED = envBool(process.env.LEADER_ELECTION_ENABLED, false);
const LEADER_LOCK_KEY = process.env.LEADER_LOCK_KEY || `matrix:leader:${process.env.WPP_SESSION || 'default'}`;
const LEADER_LOCK_TTL_MS = envNum(process.env.LEADER_LOCK_TTL_MS, 3600000);
const LEADER_RENEW_MS = Math.max(30000, Math.floor(LEADER_LOCK_TTL_MS * 0.5));

const LEADER_OPS_KEY = process.env.LEADER_OPS_KEY || `matrix:ops:${process.env.WPP_SESSION || 'default'}`;
const OP_SYNC_MS = envNum(process.env.OP_SYNC_MS, 15000);

const leaderRedis = REDIS_MAIN_URL ? new Redis(REDIS_MAIN_URL, redisOpts) : null;

// listeners (evita "Unhandled error event")
if (leaderRedis) {
  leaderRedis.on('connect', () => console.log('[redis][leader] connected'));
  leaderRedis.on('ready',   () => console.log('[redis][leader] ready'));
  leaderRedis.on('end',     () => console.warn('[redis][leader] connection ended'));
  leaderRedis.on('error',   (e) => console.warn('[redis][leader] error:', e?.code || e?.message || e));
}

async function publishOps() {
  if (!leaderRedis) return;
  await leaderRedis.hset(LEADER_OPS_KEY, {
    leader_id: INSTANCE_ID,
    intake_enabled: intakeEnabled ? '1' : '0',
    send_enabled:   sendEnabled   ? '1' : '0',
    ts: Date.now().toString(),
  });
}

async function fetchOps() {
  if (!leaderRedis) return null;
  const h = await leaderRedis.hgetall(LEADER_OPS_KEY);
  return Object.keys(h).length ? h : null;
}

async function syncOpsFollower() {
  try {
    const ops = await fetchOps();
    if (!ops) return;
    const amLeader = ops.leader_id === INSTANCE_ID;
    if (!amLeader) {
      if (intakeEnabled || sendEnabled || isLeader) {
        console.log('[ops] auto-demote (not leader). intake/send -> false');
      }
      isLeader = false;
      intakeEnabled = false;
      sendEnabled = false;
    }
  } catch (e) {
    console.warn('[ops][sync][warn]', e?.message || e);
  }
}

async function becomeLeader() {
  if (!isLeader) {
    isLeader = true;
    intakeEnabled = true;
    sendEnabled = true;
    console.log(`[leader] Became LEADER — ${INSTANCE_ID}`);
  }
  await publishOps();
}

async function becomeFollower() {
  if (isLeader || intakeEnabled || sendEnabled) {
    console.log(`[leader] Became FOLLOWER — ${INSTANCE_ID}`);
  }
  isLeader = false;
  intakeEnabled = false;
  sendEnabled = false;
}

function jitter(ms, pct = 0.2) {
  const delta = ms * pct;
  return Math.floor(ms + (Math.random() * delta - delta / 2));
}

async function leaderLoop() {
  if (!LEADER_ELECTION_ENABLED || !leaderRedis) return;

  const token = INSTANCE_ID;
  const got = await leaderRedis.set(LEADER_LOCK_KEY, token, 'PX', LEADER_LOCK_TTL_MS, 'NX');
  if (got === 'OK') {
    await becomeLeader();

    const renew = async () => {
      try {
        const ttl = await leaderRedis.pttl(LEADER_LOCK_KEY);
        if (ttl < 0) return 'reacquire';
        await leaderRedis.pexpire(LEADER_LOCK_KEY, LEADER_LOCK_TTL_MS);
        return 'ok';
      } catch (e) {
        console.error('[leader][renew][err]', e);
        return 'error';
      }
    };

    const renewTick = async () => {
      const res = await renew();
      if (res === 'ok') setTimeout(renewTick, jitter(LEADER_RENEW_MS));
      else { await becomeFollower(); setTimeout(leaderLoop, jitter(LEADER_RENEW_MS)); }
    };
    setTimeout(renewTick, jitter(LEADER_RENEW_MS));
  } else {
    await becomeFollower();
    setTimeout(leaderLoop, jitter(LEADER_RENEW_MS));
  }
}

// --------- Boot + Watchers ---------
const server = app.listen(PORT, HOST, () => {
  console.log(`[HTTP] Matrix on http://${HOST}:${PORT}`);
  console.log(`[HTTP] Rotas: GET /health | GET /wpp/health | GET /wpp/qr | GET /qr | GET /ops/status | POST /wpp/send | POST /webhook/payment | POST /inbound | POST /ops/test-alert`);
  console.log(`[Leader] mode: ${LEADER_ELECTION_ENABLED ? 'ENABLED' : 'DISABLED'} key=${LEADER_LOCK_KEY} ttl=${LEADER_LOCK_TTL_MS}ms`);

  // Só inicia heartbeat se o watcher existir
  if (typeof startHeartbeatWatcher === 'function') {
    startHeartbeatWatcher(async ({ age, windowMs }) => {
      const secs = Math.round(age / 1000);
      console.warn(`[HB] heartbeat-timeout ${secs}s (window=${windowMs}ms)`);
      try {
        await notifyDown({ reason: `heartbeat-timeout ${secs}s`, meta: { windowMs } });
      } catch (err) {
        console.error('[HB] notifyDown error:', err);
      }
    });
  } else {
    console.log('[HB] watcher ausente — skip');
  }

  if (leaderRedis) {
    setInterval(() => { if (!isLeader) { syncOpsFollower().catch(()=>{}); } }, envNum(process.env.OP_SYNC_MS, 15000));
  }
  if (LEADER_ELECTION_ENABLED && leaderRedis) {
    leaderLoop().catch((e) => console.error('[leader][fatal]', e));
  } else {
    console.warn('[leader] election disabled or REDIS_URL/MATRIX_REDIS_URL missing — using static flags');
  }
});

// Graceful shutdown
function gracefulClose(signal) {
  console.log(`[shutdown] signal=${signal}`);
  server?.close?.(() => console.log('[http] closed'));
  try { adapter?.close?.(); } catch {}
  try { outbox?.close?.(); } catch {}
  try { leaderRedis?.quit?.(); } catch {}
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT',  () => gracefulClose('SIGINT'));
process.on('SIGTERM', () => gracefulClose('SIGTERM'));
