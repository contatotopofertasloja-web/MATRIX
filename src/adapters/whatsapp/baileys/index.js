// src/adapters/whatsapp/baileys/index.js
import * as baileys from '@whiskeysockets/baileys';
import pino from 'pino';
import * as qrcode from 'qrcode';

import { notifyDown, notifyUp } from '../../../alerts/notifier.js';
import { beat } from '../../../watchers/heartbeat.js';

// ===== helpers p/ env =====
const bool = (v, d=false) => {
  if (v === undefined || v === null || v === '') return d;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'y' || s === 'yes' || s === 'on';
};
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const {
  WPP_AUTH_DIR = '/app/baileys-auth-v2',
  WPP_SESSION  = 'claudia-main',
  WPP_DEVICE   = 'Matrix-Node',
  WPP_LOG_LEVEL = 'warn',

  // booleans/números serão convertidos abaixo
  WPP_PRINT_QR = 'false',
  SEND_TYPING = 'true',
  TYPING_MS_PER_CHAR = '35',
  TYPING_MIN_MS = '800',
  TYPING_MAX_MS = '4000',
  TYPING_VARIANCE_PCT = '0.2',
} = process.env;

// conversões seguras (evita “false” virar true)
const PRINT_QR = bool(WPP_PRINT_QR, false);
const SEND_TYPING_B = bool(SEND_TYPING, true);
const TYPING_PER = num(TYPING_MS_PER_CHAR, 35);
const TYPING_MIN = num(TYPING_MIN_MS, 800);
const TYPING_MAX = num(TYPING_MAX_MS, 4000);
const TYPING_VAR = Math.max(0, Math.min(1, Number(TYPING_VARIANCE_PCT) || 0.2));

const makeWASocket =
  (baileys && (baileys.makeWASocket || baileys.default)) || null;
if (typeof makeWASocket !== 'function') {
  console.error('[baileys] import interop falhou — verifique versão do pacote');
  throw new Error('makeWASocket import error (interop)');
}

const {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason
} = baileys;

let sock;
let _isReady = false;
let _lastQrText = null;
let _onMessageHandler = null;

const logger = pino({ level: WPP_LOG_LEVEL });

// ---------- helpers ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function normalizeJid(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits) throw new Error('destinatário inválido');
  return digits.endsWith('@s.whatsapp.net') ? digits : `${digits}@s.whatsapp.net`;
}

function calcTypingDelay(chars = 12) {
  const per = Math.max(0, TYPING_PER);
  const min = Math.max(0, TYPING_MIN);
  const max = Math.max(min, TYPING_MAX);
  const base = Math.min(max, Math.max(min, Math.round(per * chars)));
  const jitter = Math.round(base * TYPING_VAR);
  const delta = Math.floor(Math.random() * (2 * jitter + 1)) - jitter;
  return Math.min(max, Math.max(min, base + delta));
}

async function simulateTyping(jid, approxChars = 12) {
  if (!SEND_TYPING_B) return;
  if (!sock) return;
  try {
    await sock.presenceSubscribe(jid);
    await sleep(250);
    await sock.sendPresenceUpdate('composing', jid);
    await sleep(calcTypingDelay(approxChars));
  } catch {}
  finally {
    try { await sock.sendPresenceUpdate('paused', jid); } catch {}
  }
}

// ---------- exports ----------
export async function getQrDataURL() {
  if (!_lastQrText) return null;
  return qrcode.toDataURL(_lastQrText, { margin: 1, width: 300 });
}
export function isReady() { return _isReady && !!sock; }

export const adapter = {
  onMessage(fn) { _onMessageHandler = typeof fn === 'function' ? fn : null; },

  async sendMessage(to, text) {
    if (!sock) throw new Error('WhatsApp não inicializado');
    const jid = normalizeJid(to);
    const msg = String(text ?? '');
    await simulateTyping(jid, msg.length);
    const res = await sock.sendMessage(jid, { text: msg });
    beat();
    return res;
  },

  async sendImage(to, url, caption = '') {
    if (!sock) throw new Error('WhatsApp não inicializado');
    const jid = normalizeJid(to);
    await simulateTyping(jid, String(caption || '').length || 12);
    const res = await sock.sendMessage(jid, { image: { url }, caption: String(caption || '') });
    beat();
    return res;
  },
};

// permite encerrar a sessão com segurança (logout) sem derrubar o processo
export async function stop() {
  try { if (sock) await sock.logout(); } catch {}
  sock = null;
  _isReady = false;
  _lastQrText = null;
}

// ---------- boot ----------
boot().catch(e => {
  console.error('[baileys][boot][fatal]', e);
  process.exitCode = 1;
});

async function boot() {
  const authDir = `${WPP_AUTH_DIR}/${WPP_SESSION}`;
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  console.log('[baileys] Using WA version:', Array.isArray(version) ? version.join('.') : version);
  console.log('[baileys] Auth path:', authDir);

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: PRINT_QR, // (ANTES: WPP_PRINT_QR === 'true')
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    browser: ['Matrix', WPP_DEVICE, '1.0.0'],
    generateHighQualityLinkPreview: true,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      _lastQrText = qr;
      if (!PRINT_QR) {
        console.log('[baileys] QR atualizado — use GET /wpp/qr para dataURL');
      }
    }

    if (connection === 'open') {
      _isReady = true;
      _lastQrText = null;
      beat();
      await notifyUp({ meta: { lib: 'baileys', session: WPP_SESSION } });
      console.log('[baileys] Conectado ✅');
    }

    if (connection === 'close') {
      _isReady = false;
      const err  = lastDisconnect?.error;
      const code =
        err?.output?.statusCode ||
        err?.status?.code ||
        err?.code ||
        (String(err?.message || '').includes('logged out') ? DisconnectReason.loggedOut : 'unknown');

      await notifyDown({
        reason: `connection=close code=${code}`,
        meta: { lib: 'baileys', session: WPP_SESSION, msg: String(err?.message || err) }
      });

      if (code !== DisconnectReason.loggedOut) {
        console.warn('[baileys] Reconectando em 2s…');
        setTimeout(() => boot().catch(e => console.error('[baileys][reboot][err]', e)), 2000);
      } else {
        console.error('[baileys] Logout detectado — reescaneie o QR.');
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (m.type !== 'notify') return;
      const msg = m.messages?.[0];
      if (!msg || msg.key.fromMe) return;
      if (!msg.message) return;

      const from = msg.key.remoteJid;
      if (!from || from.endsWith('@g.us')) return;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        msg.message.buttonsResponseMessage?.selectedDisplayText ||
        msg.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        '';

      const hasMedia = Boolean(
        msg.message.imageMessage ||
        msg.message.videoMessage ||
        msg.message.audioMessage ||
        msg.message.documentMessage ||
        msg.message.stickerMessage
      );

      beat();

      if (typeof _onMessageHandler === 'function') {
        const maybe = await _onMessageHandler({ from, text: String(text || '').trim(), hasMedia, raw: msg });
        if (typeof maybe === 'string' && maybe.trim()) {
          await adapter.sendMessage(from, maybe);
        }
      }
    } catch (e) {
      console.error('[baileys][onMessage][err]', e);
    }
  });
}
