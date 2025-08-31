// src/adapters/whatsapp/baileys/index.js
import makeWASocket, {
  Browsers,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode';
import path from 'node:path';
import fs from 'node:fs';
import { settings } from '../../../core/settings.js';

const SESSION_ID    = process.env.WPP_SESSION  || 'claudia-main';
const OUTBOX_TOPIC  = process.env.OUTBOX_TOPIC || `outbox:${SESSION_ID}`;
const QUEUE_BACKEND = (process.env.QUEUE_BACKEND || 'redis').toLowerCase(); // redis|memory|rabbit|sqs|none
const USE_QUEUE     = QUEUE_BACKEND !== 'none';

const logLevel = (process.env.WPP_LOG_LEVEL || 'warn').toLowerCase();
const logger = pino({ level: logLevel });

const AUTH_DIR = process.env.WPP_AUTH_DIR || path.join(process.cwd(), 'baileys-auth');
const DEVICE   = process.env.WPP_DEVICE   || 'Claudia-Matrix';
const PRINT_QR = String(process.env.WPP_PRINT_QR || 'false').toLowerCase() === 'true';

let sock = null;
let _onMsgCb = null;
let _ready = false;
let _qrDataURL = null;

export function isReady() { return _ready; }
export async function getQrDataURL() { return _qrDataURL; }
export function onMessage(cb) { _onMsgCb = typeof cb === 'function' ? cb : null; }

export async function init() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(path.join(AUTH_DIR, SESSION_ID));
  const { version } = await fetchLatestBaileysVersion();
  logger.info({ version }, '[WPP] WA version');

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: PRINT_QR,
    auth: state,
    browser: Browsers.macOS(DEVICE),
    syncFullHistory: false,
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      try { _qrDataURL = await qrcode.toDataURL(qr); } catch { _qrDataURL = null; }
      if (PRINT_QR) logger.info('[WPP] QR atualizado (terminal + /wpp/qr)');
    }
    if (connection === 'open') {
      _ready = true; _qrDataURL = null;
      logger.info('[WPP] Conectado ✅');
    } else if (connection === 'close') {
      _ready = false;
      const err = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error;
      logger.warn({ err }, '[WPP] Conexão fechada — tentando reconectar...');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ type, messages }) => {
    if (type !== 'notify' || !messages?.length) return;
    for (const m of messages) {
      const msg = normalizeMessage(m);
      if (!msg) continue;

      if (typeof _onMsgCb === 'function') {
        try {
          const reply = await _onMsgCb(msg);

          // — Texto (string)
          if (typeof reply === 'string' && reply) {
            if (USE_QUEUE) {
              const { enqueueOutbox } = await import('../../../core/queue/dispatcher.js');
              await enqueueOutbox({
                topic: OUTBOX_TOPIC,
                to: msg.from,
                text: reply,
                meta: { session: SESSION_ID, adapter: 'baileys', bot: settings?.botId || 'claudia' }
              });
            } else {
              await sendMessage(msg.from, reply);
            }
            continue;
          }

          // — Imagem (objeto)
          if (reply && typeof reply === 'object' && reply.type === 'image' && reply.imageUrl) {
            if (USE_QUEUE) {
              const { enqueueOutbox } = await import('../../../core/queue/dispatcher.js');
              await enqueueOutbox({
                topic: OUTBOX_TOPIC,
                to: msg.from,
                text: { type: 'image', imageUrl: reply.imageUrl, caption: reply.caption || '' },
                meta: { session: SESSION_ID, adapter: 'baileys', bot: settings?.botId || 'claudia' }
              });
            } else {
              await sendImage(msg.from, reply.imageUrl, reply.caption || '');
            }
            continue;
          }
        } catch (e) {
          logger.error({ err: String(e?.message || e) }, '[WPP] onMessage handler error');
        }
      }
    }
  });
}

// ——— Envio de TEXTO com typing humano ———
export async function sendMessage(to, text, opts = {}) {
  if (!sock) throw new Error('WPP não inicializado');
  const jid = normalizeJid(to);
  const { ms_per_char = 35, min_ms = 800, max_ms = 5000 } = settings?.typing || {};
  const len = String(text || '').length;
  const planned = Math.min(Math.max(ms_per_char * (len || 1), min_ms), max_ms);

  try {
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate('composing', jid);
    await sleep(planned);
    await sock.sendPresenceUpdate('paused', jid);
  } catch {}

  await sock.sendMessage(jid, { text, ...opts });
  return { ok: true, typed_ms: planned };
}

// ——— Envio de IMAGEM (carregada via URL) ———
export async function sendImage(to, imageUrl, caption = '') {
  if (!sock) throw new Error('WPP não inicializado');
  const jid = normalizeJid(to);
  try {
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate('composing', jid);
    await sleep(800);
    await sock.sendPresenceUpdate('paused', jid);
  } catch {}
  await sock.sendMessage(jid, { image: { url: imageUrl }, caption });
  return { ok: true };
}

export async function stop() {
  try { await sock?.logout?.(); } catch {}
  try { await sock?.end?.(); } catch {}
  _ready = false;
  sock = null;
}

// ——————————————————————————————
// EXTRA: baixar áudio (voice) → Buffer
// ——————————————————————————————
export async function getAudioBuffer(rawMsg) {
  try {
    const audio = rawMsg?.message?.audioMessage;
    if (!audio) return null;
    const stream = await downloadContentFromMessage(audio, 'audio');
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return { buffer: Buffer.concat(chunks), mimeType: audio.mimetype || 'audio/ogg' };
  } catch {
    return null;
  }
}

// Helpers
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function normalizeJid(input) {
  const s = String(input || '').replace(/\D/g, '');
  return s.endsWith('@s.whatsapp.net') ? s : `${s}@s.whatsapp.net`;
}
function normalizeMessage(m) {
  try {
    const from = m?.key?.remoteJid || '';
    const isFromMe = !!m?.key?.fromMe;

    const txt = m?.message?.conversation
      || m?.message?.extendedTextMessage?.text
      || m?.message?.ephemeralMessage?.message?.extendedTextMessage?.text
      || m?.message?.imageMessage?.caption
      || m?.message?.videoMessage?.caption
      || '';

    const hasImage = !!m?.message?.imageMessage;
    const hasVideo = !!m?.message?.videoMessage;
    const hasAudio = !!m?.message?.audioMessage;
    const hasDoc   = !!m?.message?.documentMessage;

    const hasMedia = hasImage || hasVideo || hasAudio || hasDoc;
    const mediaType = hasAudio ? 'audio' : hasImage ? 'image' : hasVideo ? 'video' : hasDoc ? 'document' : null;
    const mimeType =
      m?.message?.audioMessage?.mimetype ||
      m?.message?.imageMessage?.mimetype ||
      m?.message?.videoMessage?.mimetype ||
      m?.message?.documentMessage?.mimetype ||
      null;

    return { from, text: (txt || '').trim(), hasMedia, mediaType, mimeType, isFromMe, raw: m };
  } catch { return null; }
}

export default { init, onMessage, sendMessage, sendImage, stop, isReady, getQrDataURL, getAudioBuffer };
