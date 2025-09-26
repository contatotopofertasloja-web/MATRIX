// src/adapters/whatsapp/baileys/index.js
// Adapter Baileys com QR exposto, áudio end-to-end e compat de legado.
// + logs para debug em Railway
// + FIX: ignora mensagens 'fromMe' (evita eco/loop e "bot mudo")

import * as qrcode from "qrcode";
import fs from "node:fs/promises";
import path from "node:path";
import { sanitizeOutbound } from "../../../utils/polish.js";

// Import dinâmico (whiskeysockets > adiwajshing)
let B = null;
try { B = await import("@whiskeysockets/baileys"); }
catch { try { B = await import("@adiwajshing/baileys"); } catch { B = null; } }

function pick(fn) { return B?.[fn] || B?.default?.[fn] || null; }
function pickMakeWASocket() {
  return pick("makeWASocket")
      || (typeof B?.default === "function" ? B.default : null)
      || (typeof B === "function" ? B : null);
}
const makeWASocket               = pickMakeWASocket();
const useMultiFileAuthState      = pick("useMultiFileAuthState");
const fetchLatestBaileysVersion  = pick("fetchLatestBaileysVersion");
const DisconnectReason           = pick("DisconnectReason");
const downloadContentFromMessage = pick("downloadContentFromMessage");

if (typeof makeWASocket !== "function") {
  throw new TypeError("[baileys] Pacote não encontrado ou incompatível");
}

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

const bool = (v, d=false) => (v==null?d:["1","true","y","yes","on"].includes(String(v).trim().toLowerCase()));
const num  = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const PRINT_QR      = bool(WPP_PRINT_QR, true);
const SEND_TYPING_B = bool(SEND_TYPING, true);
const TYPING_PER    = num(TYPING_MS_PER_CHAR, 35);
const TYPING_MIN    = num(TYPING_MIN_MS, 800);
const TYPING_MAX    = num(TYPING_MAX_MS, 4000);
const TYPING_VAR    = Math.max(0, Math.min(1, Number(TYPING_VARIANCE_PCT) || 0.2));

let sock = null;
let _isReady = false;
let _lastQrText = null;
let _onMessageHandler = null;
let _booting = false;
let _callbacks = { onReady:null, onQr:null, onDisconnect:null };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function normalizeJid(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) throw new Error("destinatário inválido");
  return digits.endsWith("@s.whatsapp.net") ? digits : `${digits}@s.whatsapp.net`;
}
function typingDelay(chars = 12) {
  const base = Math.min(TYPING_MAX, Math.max(TYPING_MIN, Math.round(TYPING_PER * chars)));
  const jitter = Math.round(base * TYPING_VAR);
  const delta = Math.floor(Math.random() * (2 * jitter + 1)) - jitter;
  return Math.min(TYPING_MAX, Math.max(TYPING_MIN, base + delta));
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

export function isReady() { return _isReady && !!sock; }
export async function getQrDataURL() {
  if (!_lastQrText) return null;
  try { return await qrcode.toDataURL(_lastQrText, { margin: 1, width: 300 }); }
  catch { return null; }
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

    console.log(`[wpp/sendMessage] to=${jid} preview=${safeText.slice(0,60)}`);
    return sock.sendMessage(jid, isObj ? { ...payload, text: safeText } : { text: safeText });
  },

  async sendImage(to, url, caption = "", opts = {}) {
    if (!sock) throw new Error("WhatsApp não inicializado");
    const jid = normalizeJid(to);
    const safeCap = finalizeOutbound(caption, { allowPrice: !!opts.allowPrice, allowLink: !!opts.allowLink });
    console.log(`[wpp/sendImage] to=${jid} url=${url} captionPreview=${safeCap.slice(0,40)}`);
    return sock.sendMessage(jid, { image: { url: String(url) }, caption: safeCap });
  },

  async sendAudio(to, buffer, { mime = "audio/ogg; codecs=opus", ptt = true } = {}) {
    if (!sock) throw new Error("WhatsApp não inicializado");
    const jid = normalizeJid(to);
    console.log(`[wpp/sendAudio] to=${jid} bytes=${buffer?.length || 0}`);
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

// --- helpers de inbound ---
function extractText(msg = {}) {
  const m = msg.message || {};
  return (
    m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.documentMessage?.caption
    || m.buttonsResponseMessage?.selectedDisplayText
    || m.templateButtonReplyMessage?.selectedDisplayText
    || m.listResponseMessage?.singleSelectReply?.selectedRowId
    || ""
  );
}
function isStatusBroadcast(jid = "") { return String(jid).startsWith("status@"); }

// Boot/Reboot
async function boot() {
  if (_booting) return;
  _booting = true;
  try {
    const authDir = path.join(WPP_AUTH_DIR, WPP_SESSION);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2,3000,0] }));

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: PRINT_QR,
      browser: ["Matrix IA 2.0", "Chrome", "10.0"],
      syncFullHistory: false,
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        _lastQrText = qr;
        console.log("[wpp/qr] novo QR gerado");
        try {
          const dataURL = await qrcode.toDataURL(qr, { margin: 1, width: 300 });
          if (typeof _callbacks.onQr === "function") _callbacks.onQr(dataURL);
        } catch (e) {
          console.warn("[baileys] QR toDataURL fail:", e?.message || e);
        }
      }
      if (connection === "open")  {
        _isReady = true; _lastQrText = null;
        console.log("[wpp] conexão aberta");
        if (typeof _callbacks.onReady === "function") _callbacks.onReady();
      }
      if (connection === "close") {
        _isReady = false;
        const reason = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.reason;
        console.warn("[wpp] conexão fechada:", reason);
        if (typeof _callbacks.onDisconnect === "function") _callbacks.onDisconnect(reason);
        if (reason !== DisconnectReason?.loggedOut) {
          setTimeout(boot, 2000).unref();
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
      const m = messages?.[0];
      if (!m || !_onMessageHandler) return;

      // ✅ IGNORAR ecos do próprio número (evita loop e "bot mudo")
      if (m.key?.fromMe) return;

      const from = m.key?.remoteJid || "";
      // ✅ Ignora status/broadcast (não é conversa de cliente)
      if (!from || isStatusBroadcast(from)) return;

      // Se houver participante (grupos), usamos o remoteJid mesmo; o core trata o restante.

      const hasMedia =
        !!m.message?.imageMessage
        || !!m.message?.audioMessage
        || !!m.message?.videoMessage
        || !!m.message?.documentMessage
        || !!m.message?.stickerMessage;

      const text = extractText(m);

      console.log(`[wpp/inbound] from=${from} textPreview=${String(text || "").slice(0,60)}`);

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

export async function init({ onReady, onQr, onDisconnect } = {}) {
  _callbacks = { onReady, onQr, onDisconnect };
  await boot();
}

export async function stop() {
  try { await sock?.logout?.(); } catch {}
  try { await sock?.end?.(); } catch {}
  sock = null; _isReady = false; _lastQrText = null;
}

export async function forceRefreshQr() {
  if (_isReady) return false;
  try { await stop(); } catch {}
  await boot();
  return true;
}

export async function logoutAndReset() {
  try { await stop(); } catch {}
  try {
    const dir = path.join(WPP_AUTH_DIR, WPP_SESSION);
    await fs.rm(dir, { recursive: true, force: true });
  } catch {}
  await boot();
  return true;
}

export async function createBaileysClient() { await init(); return { sock, isReady, getQrDataURL, adapter }; }
export default { init, stop, isReady, getQrDataURL, adapter, forceRefreshQr, logoutAndReset };
