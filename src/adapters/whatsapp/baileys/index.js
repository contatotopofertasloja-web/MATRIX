// src/adapters/whatsapp/baileys/index.js
// ---------------------------------------------------------------------------
// Adapter Baileys robusto (ESM) com compatibilidade para código legado.
// ---------------------------------------------------------------------------

import * as qrcode from 'qrcode';

// tenta importar do pacote oficial ou fallback antigo
let B = null;
try {
  B = await import('@whiskeysockets/baileys');
} catch {
  try {
    B = await import('@adiwajshing/baileys');
  } catch {
    B = null;
  }
}

function pick(fnName) {
  return B?.[fnName] || B?.default?.[fnName] || null;
}
function pickMakeWASocket() {
  return (
    pick('makeWASocket') ||
    (typeof B?.default === 'function' ? B.default : null) ||
    (typeof B === 'function' ? B : null)
  );
}

const makeWASocket = pickMakeWASocket();
const useMultiFileAuthState = pick('useMultiFileAuthState');
const fetchLatestBaileysVersion = pick('fetchLatestBaileysVersion');
const DisconnectReason = pick('DisconnectReason');

if (typeof makeWASocket !== 'function') {
  throw new TypeError('[baileys] Pacote não encontrado ou incompatível');
}

// ------------------------- ENV -------------------------
const bool = (v, d = false) => {
  if (v === undefined || v === null || v === '') return d;
  const s = String(v).trim().toLowerCase();
  return ['1','true','y','yes','on'].includes(s);
};
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const {
  WPP_AUTH_DIR = '/app/baileys-auth-v2',
  WPP_SESSION = 'claudia-main',
  WPP_PRINT_QR = 'true',
  SEND_TYPING = 'true',
  TYPING_MS_PER_CHAR = '35',
  TYPING_MIN_MS = '800',
  TYPING_MAX_MS = '4000',
  TYPING_VARIANCE_PCT = '0.2',
} = process.env;

const PRINT_QR = bool(WPP_PRINT_QR, true);
const SEND_TYPING_B = bool(SEND_TYPING, true);
const TYPING_PER = num(TYPING_MS_PER_CHAR, 35);
const TYPING_MIN = num(TYPING_MIN_MS, 800);
const TYPING_MAX = num(TYPING_MAX_MS, 4000);
const TYPING_VAR = Math.max(0, Math.min(1, Number(TYPING_VARIANCE_PCT) || 0.2));

// ------------------------- ESTADO -------------------------
let sock = null;
let _isReady = false;
let _lastQrText = null;
let _onMessageHandler = null;
let _booting = false;

// helpers
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function normalizeJid(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits) throw new Error('destinatário inválido');
  return digits.endsWith('@s.whatsapp.net') ? digits : `${digits}@s.whatsapp.net`;
}
function typingDelay(chars = 12) {
  const per = Math.max(0, TYPING_PER);
  const min = Math.max(0, TYPING_MIN);
  const max = Math.max(min, TYPING_MAX);
  const base = Math.min(max, Math.max(min, Math.round(per * chars)));
  const jitter = Math.round(base * TYPING_VAR);
  const delta = Math.floor(Math.random() * (2 * jitter + 1)) - jitter;
  return Math.min(max, Math.max(min, base + delta));
}
async function simulateTyping(jid, approxChars = 12) {
  if (!SEND_TYPING_B || !sock) return;
  try {
    await sock.presenceSubscribe(jid);
    await sleep(200);
    await sock.sendPresenceUpdate('composing', jid);
    await sleep(typingDelay(approxChars));
  } catch {} finally {
    try { await sock.sendPresenceUpdate('paused', jid); } catch {}
  }
}

// ------------------------- API -------------------------
export function isReady() { return _isReady && !!sock; }
export async function getQrDataURL() {
  if (!_lastQrText) return null;
  return qrcode.toDataURL(_lastQrText, { margin: 1, width: 300 });
}
export const adapter = {
  onMessage(fn) { _onMessageHandler = typeof fn === 'function' ? fn : null; },
  async sendMessage(to, text) {
    if (!sock) throw new Error('WhatsApp não inicializado');
    const jid = normalizeJid(to);
    const msg = String(text ?? '');
    await simulateTyping(jid, msg.length || 12);
    return sock.sendMessage(jid, { text: msg });
  },
  async sendImage(to, url, caption='') {
    if (!sock) throw new Error('WhatsApp não inicializado');
    const jid = normalizeJid(to);
    return sock.sendMessage(jid, { image: { url: String(url) }, caption });
  },
};

// compatibilidade legado
export async function createBaileysClient() {
  await init();
  return { onMessage: adapter.onMessage, sendMessage: adapter.sendMessage, sendImage: adapter.sendImage, isReady, getQrDataURL, stop };
}

// ------------------------- BOOT -------------------------
export async function stop() {
  try { if (sock) await sock.logout(); } catch {}
  sock = null; _isReady = false; _lastQrText = null;
}
export async function init() {
  if (_booting) return;
  _booting = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(`${WPP_AUTH_DIR}/${WPP_SESSION}`);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: PRINT_QR,
      browser: ['Matrix', 'Claudia', '1.0.0'],
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: true,
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) { _lastQrText = qr; if (!PRINT_QR) console.log('[WPP] QR atualizado (GET /wpp/qr)'); }
      if (connection === 'open') { _isReady = true; _lastQrText = null; console.log('[WPP] Conectado ✅'); }
      if (connection === 'close') {
        _isReady = false;
        const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.code || 'unknown';
        console.warn('[WPP] Conexão fechada', code);
        if (code !== DisconnectReason.loggedOut) setTimeout(() => init().catch(console.error), 2000);
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      try {
        if (m.type !== 'notify') return;
        const msg = m.messages?.[0];
        if (!msg || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        if (!from || from.endsWith('@g.us')) return;

        const text = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || msg.message?.imageMessage?.caption
          || msg.message?.videoMessage?.caption
          || '';

        const hasMedia = !!(msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage);

        if (typeof _onMessageHandler === 'function') {
          const maybe = await _onMessageHandler({ from, text, hasMedia, raw: msg });
          if (typeof maybe === 'string' && maybe.trim()) {
            await adapter.sendMessage(from, maybe);
          }
        }
      } catch (e) { console.error('[baileys][upsert]', e); }
    });
  } finally { _booting = false; }
}

// boot imediato
init().catch(err => console.error('[baileys][init]', err));
