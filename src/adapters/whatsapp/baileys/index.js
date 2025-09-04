// deps (robusto ao ESM/CJS)
import * as baileys from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

// destruturação segura: em alguns ambientes o default não vem direto
const makeWASocket = baileys.default || baileys.makeWASocket || baileys;
const { fetchLatestBaileysVersion, useMultiFileAuthState, DisconnectReason } = baileys;

// ENVs importantes
const AUTH_DIR  = process.env.WPP_AUTH_DIR || './baileys-auth';
const SESSION   = process.env.WPP_SESSION || 'default';
const PRINT_QR  = String(process.env.WPP_PRINT_QR || 'true') === 'true';

const AUTH_PATH = path.join(AUTH_DIR, SESSION);
if (!existsSync(AUTH_PATH)) mkdirSync(AUTH_PATH, { recursive: true });

// Estado interno
let sock;
let _isReady = false;
let _lastQrText = null;   // cache do QR pro endpoint
let _onMessage = null;
let _booting = false;

// API pública esperada pelo servidor HTTP
export const adapter = {
  onMessage(fn) { _onMessage = (typeof fn === 'function') ? fn : null; },
  async sendMessage(to, text) {
    if (!sock) throw new Error('WhatsApp não inicializado');
    const jid = normalizeJid(to);
    return sock.sendMessage(jid, { text: String(text ?? '') });
  },
  async sendImage(to, url, caption='') {
    if (!sock) throw new Error('WhatsApp não inicializado');
    const jid = normalizeJid(to);
    return sock.sendMessage(jid, { image: { url: String(url) }, caption: String(caption) });
  },
};

export function isReady() {
  return _isReady && !!sock;
}

// usado pelo endpoint /wpp/qr
export async function getQrDataURL() {
  if (!_lastQrText) return null;
  return qrcode.toDataURL(_lastQrText, { margin: 1, width: 300 });
}

export async function stop() {
  try { if (sock) await sock.logout(); } catch {}
  sock = null;
  _isReady = false;
  _lastQrText = null;
}

// Inicializa (idempotente)
export async function init() {
  if (_booting) return;
  _booting = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);
    const { version } = await fetchLatestBaileysVersion();

    if (typeof makeWASocket !== 'function') {
      console.error('[baileys] makeWASocket não é função — verifique versões/interop');
      throw new Error('makeWASocket import error');
    }

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: PRINT_QR, // QR ASCII nos logs do Railway
      browser: ['Matrix', 'Claudia', '1.0.0'],
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;

      if (qr) {
        _lastQrText = qr; // sem isso, /wpp/qr fica “indisponível”
        if (!PRINT_QR) console.log('[WPP] QR atualizado (GET /wpp/qr)');
      }

      if (connection === 'open') {
        _isReady = true;
        _lastQrText = null; // após parear, some do endpoint
        console.log('[WPP] Conectado ✅');
      }

      if (connection === 'close') {
        _isReady = false;
        const err = lastDisconnect?.error;
        const code = err?.output?.statusCode || err?.code || 'unknown';
        console.warn('[WPP] Conexão fechada', code, err?.message);
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        if (shouldReconnect) setTimeout(() => init().catch(console.error), 2000);
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      try {
        if (m.type !== 'notify') return;
        const msg = m.messages?.[0];
        if (!msg || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        if (!from || from.endsWith('@g.us')) return;

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          '';

        const hasMedia = !!(
          msg.message?.imageMessage ||
          msg.message?.videoMessage ||
          msg.message?.audioMessage ||
          msg.message?.documentMessage ||
          msg.message?.stickerMessage
        );

        if (typeof _onMessage === 'function') {
          const maybe = await _onMessage({ from, text, hasMedia, raw: msg });
          if (typeof maybe === 'string' && maybe.trim()) {
            await adapter.sendMessage(from, maybe);
          }
        }
      } catch (e) {
        console.error('[baileys][upsert]', e);
      }
    });
  } finally {
    _booting = false;
  }
}

// Compat com código legado que chamava createBaileysClient()
export async function createBaileysClient() {
  await init();
  return {
    onMessage: adapter.onMessage,
    sendMessage: adapter.sendMessage,
    sendImage: adapter.sendImage,
    stop, isReady, getQrDataURL
  };
}

// helpers
function normalizeJid(s) {
  const d = String(s).replace(/\D/g, '');
  return d.endsWith('@s.whatsapp.net') ? d : `${d}@s.whatsapp.net`;
}

// boot automático
init().catch(err => console.error('[baileys][init]', err));
