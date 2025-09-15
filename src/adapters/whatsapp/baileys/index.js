// src/adapters/whatsapp/baileys/index.js
// ---------------------------------------------------------------------------
// Adapter Baileys com QR exposto, áudio end-to-end e compat de legado.
// ---------------------------------------------------------------------------
import * as qrcode from "qrcode";
import { sanitizeOutbound } from "../../../utils/polish.js";

// Import dinâmico com fallback
let B = null;
try { B = await import("@whiskeysockets/baileys"); }
catch { try { B = await import("@adiwajshing/baileys"); } catch { B = null; } }

function pick(fn) { return B?.[fn] || B?.default?.[fn] || null; }
function pickMakeWASocket() {
  return pick("makeWASocket") ||
         (typeof B?.default === "function" ? B.default : null) ||
         (typeof B === "function" ? B : null);
}
const makeWASocket               = pickMakeWASocket();
const useMultiFileAuthState      = pick("useMultiFileAuthState");
const fetchLatestBaileysVersion  = pick("fetchLatestBaileysVersion");
const DisconnectReason           = pick("DisconnectReason");
const downloadContentFromMessage = pick("downloadContentFromMessage");

if (typeof makeWASocket !== "function") {
  throw new TypeError("[baileys] Pacote não encontrado ou incompatível");
}

// ENV
const bool = (v, d=false) => (v==null?d:["1","true","y","yes","on"].includes(String(v).trim().toLowerCase()));
const num  = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const {
  WPP_AUTH_DIR        = "/app/baileys-auth-v2",
  WPP_SESSION         = "claudia-main",
  WPP_PRINT_QR        = "true",
  SEND_TYPING         = "true",
  TYPING_MS_PER_CHAR  = "35",
  TYPING_MIN_MS       = "800",
  TYPING_MAX_MS       = "4000",
  TYPING_VARIANCE_PCT = "0.2",
} = process.env;

const PRINT_QR      = bool(WPP_PRINT_QR, true);
const SEND_TYPING_B = bool(SEND_TYPING, true);
const TYPING_PER    = num(TYPING_MS_PER_CHAR, 35);
const TYPING_MIN    = num(TYPING_MIN_MS, 800);
const TYPING_MAX    = num(TYPING_MAX_MS, 4000);
const TYPING_VAR    = Math.max(0, Math.min(1, Number(TYPING_VARIANCE_PCT) || 0.2));

// Estado
let sock = null;
let _isReady = false;
let _lastQrText = null;
let _onMessageHandler = null;
let _booting = false;

// Helpers
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function normalizeJid(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) throw new Error("destinatário inválido");
  return digits.endsWith("@s.whatsapp.net") ? digits : `${digits}@s.whatsapp.net`;
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
    await sock.sendPresenceUpdate("composing", jid);
    await sleep(typingDelay(approxChars));
  } catch {} finally {
    try { await sock.sendPresenceUpdate("paused", jid); } catch {}
  }
}
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}
async function getAudioBufferFromRaw(raw) {
  try {
    const audio = raw?.message?.audioMessage;
    if (!audio || !downloadContentFromMessage) return null;
    const stream = await downloadContentFromMessage(audio, "audio");
    return await streamToBuffer(stream);
  } catch (e) {
    console.warn("[baileys] getAudioBufferFromRaw", e?.message || e);
    return null;
  }
}

// API básica
export function isReady() { return _isReady && !!sock; }
export async function getQrDataURL() {
  if (!_lastQrText) return null;
  return qrcode.toDataURL(_lastQrText, { margin: 1, width: 300 });
}
function finalizeOutbound(text, { allowPrice=false, allowLink=false } = {}) {
  return sanitizeOutbound(String(text || ""), { allowPrice, allowLink });
}

export const adapter = {
  onMessage(fn) { _onMessageHandler = typeof fn === "function" ? fn : null; },

  async sendMessage(to, payload) {
    if (!sock) throw new Error("WhatsApp não inicializado");
    const jid   = normalizeJid(to);
    const isObj = payload && typeof payload === "object" && !Buffer.isBuffer(payload);
    const text  = isObj ? String(payload.text ?? "") : String(payload ?? "");
    const approx = text?.length || 12;

    await simulateTyping(jid, approx);

    const allowPrice = isObj && !!payload.allowPrice;
    const allowLink  = isObj && !!payload.allowLink;
    const safeText   = finalizeOutbound(text, { allowPrice, allowLink });

    return sock.sendMessage(jid, isObj ? { ...payload, text: safeText } : { text: safeText });
  },

  async sendImage(to, url, caption = "", opts = {}) {
    if (!sock) throw new Error("WhatsApp não inicializado");
    const jid        = normalizeJid(to);
    const safeCap    = finalizeOutbound(caption, { allowPrice: !!opts.allowPrice, allowLink: !!opts.allowLink });
    return sock.sendMessage(jid, { image: { url: String(url) }, caption: safeCap });
  },

  async sendAudio(to, buffer, { mime = "audio/ogg; codecs=opus", ptt = true } = {}) {
    if (!sock) throw new Error("WhatsApp não inicializado");
    const jid = normalizeJid(to);
    return sock.sendMessage(jid, { audio: buffer, mimetype: mime, ptt: !!ptt });
  },

  async sendVoice(to, buffer, { mime = "audio/ogg; codecs=opus" } = {}) {
    return this.sendAudio(to, buffer, { mime, ptt: true });
  },

  async getAudioBuffer(raw) { return await getAudioBufferFromRaw(raw); },
  async downloadMedia(raw, { audioOnly = false } = {}) {
    if (audioOnly) return await getAudioBufferFromRaw(raw);
    return null;
  },
};

// Boot/Reboot
async function boot() {
  if (_booting) return;
  _booting = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(`${WPP_AUTH_DIR}/${WPP_SESSION}`);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2,3000,0] }));

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: PRINT_QR,
      browser: ["Matrix IA 2.0", "Chrome", "10.0"],
      syncFullHistory: false,
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) _lastQrText = qr;
      if (connection === "open")  _isReady = true;
      if (connection === "close") {
        _isReady = false;
        const reason = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.reason;
        if (reason !== DisconnectReason.loggedOut) {
          setTimeout(boot, 2000); // tenta reconectar
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
      const m = messages?.[0];
      if (!m || !_onMessageHandler) return;
      const from = m.key?.remoteJid || "";
      const hasMedia = !!m.message?.imageMessage || !!m.message?.audioMessage;
      const text = m.message?.conversation || m.message?.extendedTextMessage?.text || "";
      try {
        await _onMessageHandler({ from, text, hasMedia, raw: m });
      } catch (e) {
        console.error("[onMessage handler]", e?.message || e);
      }
    });
  } finally {
    _booting = false;
  }
}
export async function init() { await boot(); }
export async function stop() { try { await sock?.logout?.(); } catch {} try { await sock?.end?.(); } catch {} }

// Compat legado
export async function createBaileysClient() { await init(); return { sock, isReady, getQrDataURL, adapter }; }
export default { init, stop, isReady, getQrDataURL, adapter };
