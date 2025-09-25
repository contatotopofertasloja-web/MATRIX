// src/index.js — Matrix IA 2.0 (HTTP + WPP + Outbox/Direct + ASR + TTS + LLM + Proveniência + Confinamento por flow)
// Core neutro. Filtra JSON do LLM, aplica guardrails de link, controla áudio end-to-end.
// + Anti-spam, idempotência curta e rastreio leve (trace buffer em memória).

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { init as wppInit, adapter, isReady as wppReady, getQrDataURL } from './adapters/whatsapp/index.js';
import { createOutbox } from './core/queue.js';
import { stopOutboxWorkers } from './core/queue/dispatcher.js';

import { BOT_ID, settings } from './core/settings.js';
import { loadFlows } from './core/flow-loader.js';
import { intentOf } from './core/intent.js';
import { callLLM } from './core/llm.js';
import { getBotHooks } from './core/bot-registry.js';
import { orchestrate } from './core/orchestrator.js';

// >>> NOVO: sessão persistente
import { loadSession, saveSession } from './core/session.js';

// ===== MÉTRICAS (novos)
import { attachMetricsRoutes } from './core/metrics/receiver.js';
import { flushMetricsNow } from './core/metrics/middleware.js';

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

// ===== Promoções (sorteio): import dinâmico
let promotions = null;
try {
  const pmod = await import('./core/promotions.js');
  promotions = pmod?.default || pmod;
} catch {
  console.warn('[promotions] módulo ausente — endpoints seguirão sem erro.');
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
const OPS_TOKEN = process.env.OPS_TOKEN || process.env.ADMIN_TOKEN || '';

const ECHO_MODE     = envBool(process.env.ECHO_MODE, false);
let intakeEnabled   = envBool(process.env.INTAKE_ENABLED, true);
let sendEnabled     = envBool(process.env.SEND_ENABLED, true);
let DIRECT_SEND     = envBool(process.env.DIRECT_SEND, true);

// Anti-spam (ajustável por ENV)
const MIN_GAP_PER_CONTACT_MS = envNum(process.env.QUEUE_OUTBOX_MIN_GAP_MS, 2500);
const MIN_GAP_GLOBAL_MS      = envNum(process.env.QUEUE_OUTBOX_MIN_GAP_GLOBAL_MS, 800);

// Redis / Outbox
const REDIS_MAIN_URL = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';
const OUTBOX_TOPIC = process.env.OUTBOX_TOPIC || `outbox:${process.env.WPP_SESSION || 'default'}`;
const OUTBOX_CONCURRENCY = envNum(process.env.QUEUE_OUTBOX_CONCURRENCY, 1);

const outbox = await createOutbox({
  topic: OUTBOX_TOPIC,
  concurrency: OUTBOX_CONCURRENCY,
  redisUrl: REDIS_MAIN_URL,
});

await outbox.start(async (job) => {
  const { to, kind = 'text', payload = {} } = job || {};
  await sendViaAdapter(to, kind, payload);
});

// =================== Flows/Hooks ===================
const flows = await loadFlows(BOT_ID);
const hooks = await getBotHooks();

// =================== Proveniência & Trace ===================
const TRACE_MAX = 800;
const traceBuf = []; // { ts, from, text_in, source, preview, intent, stage, path }
function pushTrace(entry) {
  traceBuf.push({ ts: Date.now(), ...entry });
  if (traceBuf.length > TRACE_MAX) traceBuf.splice(0, traceBuf.length - TRACE_MAX);
}

function tag(text, sourceTag) {
  const s = String(text || '');
  if (!s.trim()) return s;
  // Se já tiver carimbo (parênteses no final), preserva:
  if (/\)\s*$/.test(s) && /\([^)]+?\)\s*$/.test(s)) return s;
  return `${s} (${sourceTag})`;
}

// =================== Helpers anti-spam/idem (AGORA NO TOPO: evita mute por ReferenceError) ===================
const sentOpening = new Set();
const lastSentAt  = new Map();
const lastHash    = new Map();
const processedIds = new Set();
setInterval(() => { if (processedIds.size > 5000) processedIds.clear(); }, 60_000).unref();

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

// =================== JSON/links sanitização ===================
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

// Utilidade hash
const hash = (s) => {
  let h = 0; const str = String(s || '');
  for (let i=0;i<str.length;i++) { h = (h*31 + str.charCodeAt(i)) | 0; }
  return h;
};
const getMsgId = (raw) => {
  try { return raw?.key?.id || raw?.message?.key?.id || ''; } catch { return ''; }
};

// =================== Entrega unificada (texto + opcional áudio) ===================
// BUG CORRIGIDO: usava `from` fora de escopo. Agora usa o `to` recebido.
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

// =================== ASR/TTS helpers ===================
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

// ======== Helpers para enviar actions[] do orquestrador ========
async function sendActions(to, actions = []) {
  if (!Array.isArray(actions) || !actions.length) return false;
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    if (a.kind === 'image' && a.url) {
      await enqueueOrDirect({ to, kind: 'image', payload: { url: a.url, caption: a.caption || '' } });
    } else if (a.kind === 'audio' && a.buffer) {
      await enqueueOrDirect({ to, kind: 'audio', payload: { buffer: a.buffer, mime: a.mime || 'audio/ogg' } });
    } else if (a.kind === 'text' && a.text) {
      await enqueueOrDirect({ to, payload: { text: prepareOutboundText(a.text) } });
    }
  }
  return true;
}

// =================== Handler principal ===================
adapter.onMessage(async ({ from, text, hasMedia, raw }) => {
  if (!intakeEnabled) return '';
  // >>> NOVO: carrega sessão persistente
  const state = await loadSession(BOT_ID, from);

  // helper: salvar sessão antes de sair
  const persist = async () => { try { await saveSession(BOT_ID, from, state); } catch {} };

  try {
    const now = Date.now();

    // --------- Idempotência de inbound ---------
    const mid = getMsgId(raw);
    if (mid) {
      if (processedIds.has(mid)) { await persist(); return ''; }
      processedIds.add(mid);
      setTimeout(() => processedIds.delete(mid), 3 * 60_000).unref();
    } else {
      const h = `${from}:${hash(text)}`;
      if (lastHash.get(from) === h && (now - (lastSentAt.get(from) || 0)) < 3000) { await persist(); return ''; }
      lastHash.set(from, h);
    }

    // mídia de abertura (1x por contato)
    if (!sentOpening.has(from)) {
      const media = await hooks.openingMedia({ settings });
      if (media?.url && settings?.flags?.send_opening_photo !== false) {
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
      const stamped = tag(`Echo: ${text}`, 'echo');
      await enqueueOrDirect({ to: from, payload: { text: stamped } });
      lastSentAt.set(from, now);
      pushTrace({ from, text_in: text, source: 'echo', preview: stamped.slice(0,120), intent: 'echo', stage: 'echo', path: 'direct' });
      await persist();
      return '';
    }

    // texto base (ou ASR p/ áudio)
    let msgText = (text || '').trim();
    const incomingIsAudio = !!raw?.message?.audioMessage;
    if (hasMedia && !msgText && incomingIsAudio) {
      const buf = await tryGetAudioBuffer(raw);
      const asr = buf ? await transcribeIfPossible(buf) : null;
      if (asr && asr.trim()) msgText = asr.trim();
    }
    if (!msgText) { await persist(); return ''; }

    // --------- Cooldown por contato ---------
    const last = lastSentAt.get(from) || 0;
    if (now - last < MIN_GAP_PER_CONTACT_MS) { await persist(); return ''; }

    // webhook-like por texto (pós-venda)
    if (/(\bpaguei\b|\bpagamento\s*feito\b|\bcomprovante\b|\bfinalizei\b)/i.test(msgText)) {
      await hooks.onPaymentConfirmed({
        jid: from,
        settings,
        send: async (to, t) => enqueueOrDirect({ to, payload: { text: t } }),
      });
      lastSentAt.set(from, Date.now());
      pushTrace({ from, text_in: msgText, source: 'hook:payment', preview: 'onPaymentConfirmed', intent: 'postsale', stage: 'posvenda', path: 'direct' });
      await persist();
      return '';
    }

    // --------- Roteamento com confinamento por flow ---------
    const flowOnly = !!settings?.flags?.flow_only;
    const wantAudio = incomingIsAudio;
    const userIntent = intentOf(msgText);

    let used = 'unknown';
    let reply = '';

    // 1) FLOW RUNNER (configs/bots/<bot>/flow/index.js -> handle())
    const hasFlowRunner = typeof flows?.__handle === 'function' || typeof flows?.handle === 'function';
    if (hasFlowRunner) {
      const handleFn = flows.__handle || flows.handle;
      const out = await handleFn({ jid: from, text: msgText, settings, state, send: (to, t) => deliverReply({ to, text: t, wantAudio }) });
      reply = out?.reply || '';
      used = 'flow/index';
    } else {
      // 2) FLOW UNITÁRIO via loader.__route() ou intent→map
      let flowObj = null;
      try { if (typeof flows?.__route === 'function') flowObj = flows.__route(msgText, settings, from); } catch {}
      if (!flowObj) flowObj = flows?.[userIntent] || flows?.greet;

      if (flowObj?.run) {
        const send = async (to, t) => deliverReply({ to, text: String(t || ''), wantAudio });
        await flowObj.run({ jid: from, text: msgText, settings, send, state });
        used = `flow/${flowObj?.name || userIntent}`;
      }
    }

    // Se o flow devolveu reply textual direta
    if (reply && reply.trim()) {
      const stamped = settings?.flags?.debug_trace_replies ? tag(prepareOutboundText(reply), used.startsWith('flow') ? used.replace('flow','flow') : 'flow') : prepareOutboundText(reply);
      await deliverReply({ to: from, text: stamped, wantAudio });
      lastSentAt.set(from, Date.now());
      pushTrace({ from, text_in: msgText, source: used, preview: stamped.slice(0,120), intent: userIntent, stage: userIntent, path: DIRECT_SEND ? 'direct' : 'outbox' });
      await persist();
      return '';
    }

    // 3) LLM Orquestrador — compatível com actions[] ou string (apenas se NÃO flow_only)
    if (!flowOnly) {
      try {
        const out = await orchestrate({ jid: from, text: msgText, stageHint: userIntent, botSettings: settings });

        // a) Se for array de actions (novo orquestrador)
        if (Array.isArray(out) && out.length) {
          await sendActions(from, out);
          lastSentAt.set(from, Date.now());
          pushTrace({ from, text_in: msgText, source: 'llm/orchestrator', preview: JSON.stringify(out).slice(0,120), intent: userIntent, stage: userIntent, path: DIRECT_SEND ? 'direct' : 'outbox' });
          await persist();
          return '';
        }
        // b) Se for string (compat legado)
        if (out && String(out).trim()) {
          const stamped = settings?.flags?.debug_trace_replies ? tag(prepareOutboundText(out), 'llm/orchestrator') : prepareOutboundText(out);
          await deliverReply({ to: from, text: stamped, wantAudio });
          lastSentAt.set(from, Date.now());
          pushTrace({ from, text_in: msgText, source: 'llm/orchestrator', preview: stamped.slice(0,120), intent: userIntent, stage: userIntent, path: DIRECT_SEND ? 'direct' : 'outbox' });
          await persist();
          return '';
        }
      } catch (e) {
        console.warn('[orchestrator] erro:', e?.message || e);
      }
    }

    // 4) LLM "texto solto" (freeform) — apenas se NÃO flow_only **e** se houver prompt construído
    if (!flowOnly) {
      try {
        const built = await hooks.safeBuildPrompt({ stage: 'qualify', message: msgText, settings });
        if (built && (built.system || built.user)) {
          const { text: fb } = await callLLM({ stage: 'qualify', system: built.system, prompt: built.user });
          if (fb && String(fb).trim()) {
            const stamped = settings?.flags?.debug_trace_replies
              ? tag(prepareOutboundText(fb), 'llm/freeform')
              : prepareOutboundText(fb);
            await deliverReply({ to: from, text: stamped, wantAudio });
            lastSentAt.set(from, Date.now());
            pushTrace({ from, text_in: msgText, source: 'llm/freeform', preview: stamped.slice(0,120), intent: userIntent, stage: 'qualificacao', path: DIRECT_SEND ? 'direct' : 'outbox' });
            await persist();
            return '';
          }
        }
      } catch (e) {
        console.warn('[freeform] erro:', e?.message || e);
      }
    }

    // 5) Sem nada → fallback mínimo via hooks (apenas se NÃO flow_only e se houver texto)
    if (!flowOnly) {
      const fb = await hooks.fallbackText({ stage: 'error', message: msgText, settings });
      const textToSend = (fb && String(fb).trim()) ? prepareOutboundText(fb) : '';
      if (textToSend) {
        const stamped = settings?.flags?.debug_trace_replies ? tag(textToSend, 'hooks') : textToSend;
        await enqueueOrDirect({ to: from, payload: { text: stamped } });
        lastSentAt.set(from, Date.now());
        pushTrace({ from, text_in: msgText, source: 'hooks', preview: stamped.slice(0,120), intent: userIntent, stage: 'error', path: DIRECT_SEND ? 'direct' : 'outbox' });
        await persist();
        return '';
      }
    }

    // 6) Sem nada mesmo → silêncio (não envia “null” nem “(hooks)”)
    await persist();
    return '';
  } catch (e) {
    console.error('[onMessage]', e);
    // Erro duro: tenta fallback apenas se NÃO flow_only e se houver texto
    try {
      if (!settings?.flags?.flow_only) {
        const fb = await hooks.fallbackText({ stage: 'error', message: text || '', settings });
        const txt = (fb && String(fb).trim()) ? prepareOutboundText(fb) : '';
        if (txt) await enqueueOrDirect({ to: from, payload: { text: txt } });
      }
    } catch {}
    await persist();
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

function requireOpsAuth(req, res, next) {
  const token = req.get('X-Ops-Token') || (req.query?.token ?? '');
  if (!OPS_TOKEN) return res.status(403).json({ ok: false, error: 'OPS_TOKEN unset' });
  if (String(token) !== String(OPS_TOKEN)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Matrix IA 2.0',
    bot: BOT_ID,
    ready: wppReady(),
    env: process.env.NODE_ENV || 'production',
    ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND },
  });
});

app.get('/wpp/health', (_req, res) => {
  res.json({
    ok: true,
    ready: wppReady(),
    session: process.env.WPP_SESSION || 'default',
    backend: outbox.backend(),
    topic: OUTBOX_TOPIC,
    concurrency: OUTBOX_CONCURRENCY,
    ops: { intake_enabled: intakeEnabled, send_enabled: sendEnabled, direct_send: DIRECT_SEND },
    redis: { url: REDIS_MAIN_URL ? 'set' : 'unset', connected: outbox.isConnected() },
  });
});

// --- ROTAS QR (revisadas: no-cache + force=1) ---
app.get('/wpp/qr', async (req, res) => {
  try {
    // sempre no-store: evita QR cacheado pelo browser/reverse proxy
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

    const force = String(req.query.force || '') === '1';
    if (force) {
      const wpp = await import('./adapters/whatsapp/index.js');
      if (wpp.forceNewQr) await wpp.forceNewQr();
    }

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
    res.json({ ok: true, qr: dataURL, bot: BOT_ID });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get('/qr', (_req, res) => res.redirect(302, '/wpp/qr?view=img'));

// --- NOVO: Logout + reset de sessão (safe) ---
app.post('/wpp/logout', async (_req, res) => {
  try {
    const wpp = await import('./adapters/whatsapp/index.js');
    if (wpp?.logoutAndReset) await wpp.logoutAndReset();
    res.json({ ok: true, reset: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

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

// ===== Webhook de pagamento + promoções =====
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

// ===== Promo admin =====
function requireOps(req, res, next) {
  const token = req.get('X-Ops-Token') || (req.query?.token ?? '');
  if (!OPS_TOKEN) return res.status(403).json({ ok: false, error: 'OPS_TOKEN unset' });
  if (String(token) !== String(OPS_TOKEN)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}

app.get('/ops/promo/export', requireOps, (req, res) => {
  try {
    const month = (req.query?.month || '').toString() || undefined;
    if (!promotions || typeof promotions.exportMonth !== 'function') {
      return res.status(501).json({ ok: false, error: 'promotions module not installed' });
    }
    const r = promotions.exportMonth(month);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/ops/promo/draw', requireOps, (req, res) => {
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

app.get('/ops/promo/months', requireOps, (req, res) => {
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

app.get('/ops/promo/logs', requireOps, (req, res) => {
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

// ===== Debug/trace leve =====
app.get('/debug/last', requireOpsAuth, (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 50)));
  const from = (req.query?.from || '').toString();
  const rows = traceBuf
    .filter(r => !from || r.from === from)
    .slice(-limit)
    .reverse();
  res.json({ ok: true, count: rows.length, rows });
});

app.get('/debug/metrics', requireOpsAuth, (_req, res) => {
  const counts = traceBuf.reduce((acc, r) => {
    acc[r.source] = (acc[r.source] || 0) + 1;
    return acc;
  }, {});
  res.json({ ok: true, sources: counts, total: traceBuf.length });
});

// ===== Boot do WhatsApp e HTTP =====
await wppInit({ onQr: () => {} });
const server = app.listen(PORT, HOST, () => {
  console.log(`[HTTP] Matrix bot (${BOT_ID}) on http://${HOST}:${PORT}`);
});

// ===== Shutdown limpo (SIGINT/SIGTERM) =====
async function gracefulClose(signal) {
  console.log(`[shutdown] signal=${signal}`);
  try { await stopOutboxWorkers(); } catch (e) { console.warn('[shutdown] stopOutboxWorkers:', e?.message || e); }
  try { await flushMetricsNow(); } catch (e) { console.warn('[shutdown] flushMetricsNow:', e?.message || e); }
  try { await new Promise((resolve) => server?.close?.(() => resolve())); console.log('[http] closed'); } catch {}
  try { adapter?.close?.(); } catch {}
  try { outbox?.stop?.(); } catch {}
  setTimeout(() => process.exit(0), 1500).unref();
}
process.once('SIGINT',  () => { gracefulClose('SIGINT');  });
process.once('SIGTERM', () => { gracefulClose('SIGTERM'); });
