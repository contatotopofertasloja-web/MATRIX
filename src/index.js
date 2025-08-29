// src/index-gpt.js
import * as baileys from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { loadBotConfig } from './config/bootstrap.js';
const botConfig = loadBotConfig();
console.log(`[MATRIX] Bot carregado: ${botConfig.bot_id} (${botConfig.persona_name})`);

// ------------------------------
// ENV & Consts
// ------------------------------
const AUTH_DIR = process.env.WPP_AUTH_DIR || './baileys-auth';
const SESSION  = process.env.WPP_SESSION   || 'default';
const DEVICE   = process.env.WPP_DEVICE    || 'Matrix-Node';
const APP_VER  = process.env.WPP_APPVER    || ''; // opcional "2.24.x"
const AUTH_PATH = path.join(AUTH_DIR, SESSION);

// Typing config
const TYPING_MS_PER_CHAR = Number(process.env.TYPING_MS_PER_CHAR || 35);
const TYPING_MIN_MS      = Number(process.env.TYPING_MIN_MS || 800);
const TYPING_MAX_MS      = Number(process.env.TYPING_MAX_MS || 5000);

// Globals
let sock = null;
let ready = false;
let lastQrDataUrl = null;
let messageHandler = null; // usuário registra via adapter.onMessage

// Garante pasta de sessão
if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
if (!existsSync(AUTH_PATH)) mkdirSync(AUTH_PATH, { recursive: true });

// ------------------------------
// Helpers
// ------------------------------
function calcTypingMs(text) {
  const n = Math.max(1, String(text || '').length);
  const ms = Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, n * TYPING_MS_PER_CHAR));
  return ms;
}
const delay = (ms) => new Promise(r => setTimeout(r, ms));

function normalizeToJid(to) {
  if (!to) throw new Error('destinatário inválido');
  const s = String(to).trim();

  if (s.endsWith('@s.whatsapp.net') || s.endsWith('@g.us')) return s;

  // aceita "+55...", "55...", "5511...":
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) throw new Error('número inválido');

  // grupos não suportados aqui
  if (digits.endsWith('@g.us')) throw new Error('envio para grupo não suportado por este helper');

  return `${digits}@s.whatsapp.net`;
}

async function simulateTyping(jid, text) {
  try {
    if (!sock) return;
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate('composing', jid);
    await delay(calcTypingMs(text));
    await sock.sendPresenceUpdate('paused', jid);
  } catch (e) {
    console.warn('[WPP][typing]', e?.message || e);
  }
}

// ------------------------------
// Socket lifecycle
// ------------------------------
async function startSocket() {
  const { state, saveCreds } = await baileys.useMultiFileAuthState(AUTH_PATH);

  // Versão do WhatsApp Web suportada
  let version = (await baileys.fetchLatestBaileysVersion()).version;
  if (APP_VER) {
    try {
      // permite forçar versão via env, ex: "2.2419.9"
      const arr = APP_VER.split('.').map(x => Number(x));
      if (arr.length === 3 && arr.every(Number.isFinite)) version = arr;
    } catch {}
  }

  console.log('[WPP] Using WA version:', version?.join('.') || version);

  sock = baileys.makeWASocket({
    auth: state,
    printQRInTerminal: false, // geramos DataURL pro endpoint /wpp/qr
    browser: ['Matrix', DEVICE, '1.0.0'],
    version,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
  });

  // Atualização de credenciais no disco
  sock.ev.on('creds.update', saveCreds);

  // QR e status de conexão
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      try {
        lastQrDataUrl = await QRCode.toDataURL(qr);
      } catch (e) {
        console.error('[WPP][QR][ERR]', e?.message || e);
        lastQrDataUrl = null;
      }
    }

    if (connection === 'open') {
      ready = true;
      lastQrDataUrl = null;
      console.log('[WPP] Conectado ✅');
    } else if (connection === 'close') {
      ready = false;
      const shouldReconnect =
        !lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect.error.output.statusCode !== baileys.DisconnectReason.loggedOut;

      console.warn('[WPP] Conexão fechada', lastDisconnect?.error?.message || lastDisconnect);
      if (shouldReconnect) {
        console.log('[WPP] Tentando reconectar em 2s…');
        setTimeout(() => startSocket().catch(err => console.error('[WPP][reconnect][ERR]', err)), 2000);
      } else {
        console.error('[WPP] Logout detectado — é preciso reescanear o QR.');
      }
    }
  });

  // Recebimento de mensagens
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (m.type !== 'notify') return;
      const msg = m.messages && m.messages[0];
      if (!msg || msg.key.fromMe) return;            // ignora as nossas
      if (!msg.message) return;

      const from = msg.key.remoteJid;
      // Ignora grupos
      if (!from || from.endsWith('@g.us')) return;

      const txt =
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

      if (typeof messageHandler === 'function') {
        const maybeReply = await messageHandler({ from, text: String(txt || '').trim(), hasMedia });
        // se handler devolver string, enviamos automaticamente
        if (typeof maybeReply === 'string' && maybeReply.trim()) {
          await adapter.sendMessage(from, maybeReply);
        }
      }
    } catch (e) {
      console.error('[WPP][onMessage][ERR]', e?.message || e);
    }
  });
}

// Inicializa ao importar o módulo
startSocket().catch(err => console.error('[WPP][init][ERR]', err));

// ------------------------------
// Public API
// ------------------------------
export function isReady() {
  return Boolean(ready && sock);
}

export async function getQrDataURL() {
  return lastQrDataUrl;
}

export const adapter = {
  onMessage(fn) {
    messageHandler = fn;
  },

  async sendMessage(to, text) {
    if (!sock) throw new Error('WhatsApp não inicializado');
    const jid = normalizeToJid(to);
    await simulateTyping(jid, text);
    await sock.sendMessage(jid, { text: String(text ?? '') });
  },

  async sendImage(to, url, caption = '') {
    if (!sock) throw new Error('WhatsApp não inicializado');
    const jid = normalizeToJid(to);
    await simulateTyping(jid, caption || url);
    await sock.sendMessage(jid, {
      image: { url: String(url) },
      caption: String(caption || ''),
    });
  }
};
