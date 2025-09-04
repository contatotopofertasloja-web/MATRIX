// Adapter Baileys robusto (ESM) + QR + alerts + heartbeat
// Corrige o erro "makeWASocket não é função" via interop seguro.

import * as baileys from '@whiskeysockets/baileys';
import pino from 'pino';
import * as qrcode from 'qrcode';

import { notifyDown, notifyUp } from '../../../alerts/notifier.js';
import { beat } from '../../../watchers/heartbeat.js';

// ----------- ENV -----------
const {
  WPP_AUTH_DIR = '/app/baileys-auth-v2',
  WPP_SESSION  = 'claudia-main',
  WPP_DEVICE   = 'Matrix-Node',
  WPP_LOG_LEVEL = 'warn',
  WPP_PRINT_QR = 'false', // já servimos o dataURL por /wpp/qr
} = process.env;

// ----------- Interop seguro -----------
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

// ----------- State -----------
let sock;
let _isReady = false;
let _lastQrText = null;
let _onMessageHandler = null;

// ----------- Helpers -----------
function normalizeJid(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits) throw new Error('destinatário inválido');
  return digits.endsWith('@s.whatsapp.net') ? digits : `${digits}@s.whatsapp.net`;
}

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
    const res = await sock.sendMessage(jid, { text: String(text ?? '') });
    beat(); // atividade OK
    return res;
  },

  async sendImage(to, url, caption = '') {
    if (!sock) throw new Error('WhatsApp não inicializado');
    const jid = normalizeJid(to);
    const res = await sock.sendMessage(jid, { image: { url }, caption: String(caption || '') });
    beat();
    return res;
  },
};

// ----------- Boot -----------
boot().catch(e => {
  console.error('[baileys][boot][fatal]', e);
  process.exitCode = 1;
});

async function boot() {
  const logger = pino({ level: WPP_LOG_LEVEL });

  const authDir = `${WPP_AUTH_DIR}/${WPP_SESSION}`; // separa por sessão
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  console.log('[baileys] Using WA version:', Array.isArray(version) ? version.join('.') : version);
  console.log('[baileys] Auth path:', authDir);

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: WPP_PRINT_QR === 'true',
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    browser: ['Matrix', WPP_DEVICE, '1.0.0'],
    generateHighQualityLinkPreview: true,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  // Conexão / QR
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      _lastQrText = qr;
      if (WPP_PRINT_QR !== 'true') {
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

      // Reconnect se não for logout
      if (code !== DisconnectReason.loggedOut) {
        console.warn('[baileys] Reconectando em 2s…');
        setTimeout(() => boot().catch(e => console.error('[baileys][reboot][err]', e)), 2000);
      } else {
        console.error('[baileys] Logout detectado — reescaneie o QR.');
      }
    }
  });

  // Mensagens
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
        const maybe = await _onMessageHandler({ from, text: String(text || '').trim(), hasMedia });
        if (typeof maybe === 'string' && maybe.trim()) {
          await adapter.sendMessage(from, maybe);
        }
      }
    } catch (e) {
      console.error('[baileys][onMessage][err]', e);
    }
  });
}
