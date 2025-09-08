// src/adapters/whatsapp/baileys/index.js
// Adapter Baileys: QR estável, reconexão e compat com createBaileysClient.
// Sem dependências opcionais (pino/notifier/heartbeat) para evitar module not found.

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode';

// ------------------------- ENV HELPERS -------------------------
const bool = (v, d = false) => {
  if (v === undefined || v === null || v === '') return d;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'y' || s === 'yes' || s === 'on';
};
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ENVs com defaults seguros
const {
  WPP_AUTH_DIR = '/app/baileys-auth-v2',
  WPP_SESSION = 'claudia-main',
  WPP_DEVICE = 'Matrix-Node',

  WPP_PRINT_QR = 'true',            // manter true até parear
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

// ------------------------- ESTADO INTERNO -------------------------
let sock = null;
let _isReady = false;
let _lastQrText = null;        // cache do QR para /wpp/qr
let _onMessageHandler = null;
let _booting = false;

// ------------------------- UTILS -------------------------
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
  } catch {
    // silencioso
  } finally {
    try { await sock.sendPresenceUpdate('paused', jid); } catch {}
  }
}

// ------------------------- API / EXPORTS -------------------------
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

  async sendImage(to, url, caption = '') {
    if (!sock) throw new Error('WhatsApp não inicializado');
    const jid = normalizeJid(to);
    await simulateTyping(jid, String(caption || '').length || 12);
    return sock.sendMessage(jid, { image: { url: String(url) }, caption: String(caption || '') });
  },
};

export async function stop() {
  try { if (sock) await sock.logout(); } catch {}
  sock = null;
  _isReady = false;
  _lastQrText = null;
}

// Boot automático (idempotente)
boot().catch(err => console.error('[baileys][boot][fatal]', err));

export async function init() {
  // init explícito (se alguém chamar)
  return boot();
}

async function boot() {
  if (_booting) return;
  _booting = true;
  try {
    const authPath = `${WPP_AUTH_DIR}/${WPP_SESSION}`;
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    console.log('[baileys] WA version:', Array.isArray(version) ? version.join('.') : version);
    console.log('[baileys] Auth path:', authPath);

    sock = makeWASocket({
      version,
      auth: state,                        // forma oficial de passar as credenciais
      printQRInTerminal: PRINT_QR,        // QR ASCII nos logs (útil no Railway)
      browser: ['Matrix', WPP_DEVICE, '1.0.0'],
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;

      if (qr) {
        _lastQrText = qr;                 // chave para /wpp/qr
        if (!PRINT_QR) console.log('[baileys] QR atualizado (GET /wpp/qr)');
      }

      if (connection === 'open') {
        _isReady = true;
        _lastQrText = null;
        console.log('[baileys] Conectado ✅');
      }

      if (connection === 'close') {
        _isReady = false;
        const err = lastDisconnect?.error;
        const code =
          err?.output?.statusCode ||
          err?.status?.code ||
          err?.code ||
          (String(err?.message || '').includes('logged out') ? DisconnectReason.loggedOut : 'unknown');

        console.warn('[baileys] Conexão fechada — code:', code, '-', err?.message || '');

        // Reconnect automático, exceto quando fez logout
        if (code !== DisconnectReason.loggedOut) {
          console.warn('[baileys] Tentando reconectar em 2s…');
          setTimeout(() => boot().catch(e => console.error('[baileys][reboot]', e)), 2000);
        } else {
          console.error('[baileys] Logout detectado — reescaneie o QR.');
        }
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      try {
        if (m.type !== 'notify') return;
        const msg = m.messages?.[0];
        if (!msg || msg.key.fromMe || !msg.message) return;

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

        if (typeof _onMessageHandler === 'function') {
          const reply = await _onMessageHandler({ from, text: String(text || '').trim(), hasMedia, raw: msg });
          if (typeof reply === 'string' && reply.trim()) {
            await adapter.sendMessage(from, reply);
          }
        }
      } catch (e) {
        console.error('[baileys][onMessage][err]', e);
      }
    });
  } catch (e) {
    console.error('[baileys][boot][error]', e);
    throw e;
  } finally {
    _booting = false;
  }
}

// ---------- Compatibilidade com código legado ----------
export async function createBaileysClient() {
  await init();
  return { onMessage: adapter.onMessage, sendMessage: adapter.sendMessage, sendImage: adapter.sendImage, stop, isReady, getQrDataURL };
}
