// src/adapters/whatsapp/baileys/index.js
// Adapter Baileys + Watcher de conexão + Heartbeat integrado
// Exports: adapter, isReady, getQrDataURL

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";
import pino from "pino";
import * as qrcode from "qrcode";

// Alertas (já enviados na etapa anterior)
import { notifyDown, notifyUp } from "../../../alerts/notifier.js";
// Heartbeat (já enviado na etapa anterior)
import { beat } from "../../../watchers/heartbeat.js";

const {
  WPP_LOG_LEVEL = "warn",
  WPP_PRINT_QR = "true", // loga QR no console também
} = process.env;

let sock;
let _isReady = false;
let _lastQrText = null; // QR bruto
let _onMessageHandler = null;

// ---------------------------
// Helpers do adapter público
// ---------------------------
function setOnMessageHandler(fn) {
  _onMessageHandler = typeof fn === "function" ? fn : null;
}

async function sendMessage(to, text) {
  if (!sock) throw new Error("WhatsApp socket ainda não inicializado.");
  const jid = normalizeJid(to);
  const res = await sock.sendMessage(jid, { text: String(text ?? "") });
  // sucesso → sinaliza atividade
  beat();
  return res;
}

async function sendImage(to, url, caption = "") {
  if (!sock) throw new Error("WhatsApp socket ainda não inicializado.");
  const jid = normalizeJid(to);
  const res = await sock.sendMessage(jid, {
    image: { url },
    caption: caption || ""
  });
  beat();
  return res;
}

function isReady() {
  return _isReady;
}

async function getQrDataURL() {
  if (!_lastQrText) return null;
  // Converte o QR bruto em DataURL para UI/web
  return qrcode.toDataURL(_lastQrText, { margin: 1, width: 300 });
}

function normalizeJid(input) {
  const digits = String(input).replace(/\D/g, "");
  // Para BR, se vier sem @s.whatsapp.net
  return digits.endsWith("@s.whatsapp.net") ? digits : `${digits}@s.whatsapp.net`;
}

// API pública p/ o resto do app
export const adapter = {
  onMessage: setOnMessageHandler,
  sendMessage,
  sendImage,
};

// ---------------------------
// Boot do Baileys
// ---------------------------
boot().catch((e) => {
  console.error("[baileys][boot][fatal]", e);
  process.exitCode = 1;
});

async function boot() {
  const logger = pino({ level: WPP_LOG_LEVEL });

  const { state, saveCreds } = await useMultiFileAuthState("./wpp-auth");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: WPP_PRINT_QR === "true",
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    generateHighQualityLinkPreview: true,
    // reconexão automática já é gerida pelo Baileys internamente
  });

  // Persistência de credenciais
  sock.ev.on("creds.update", saveCreds);

  // ---------------------------
  // Watcher de conexão
  // ---------------------------
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      _lastQrText = qr;
      if (WPP_PRINT_QR !== "true") {
        console.log("[baileys] QR atualizado (use GET /wpp/qr para obter dataURL)");
      }
    }

    if (connection === "open") {
      _isReady = true;
      _lastQrText = null;
      beat(); // atividade OK
      await notifyUp({ meta: { lib: "baileys" } });
      console.log("[baileys] Conectado.");
    }

    if (connection === "close") {
      _isReady = false;
      const err = lastDisconnect?.error;
      const code =
        err?.output?.statusCode ||
        err?.status?.code ||
        err?.code ||
        (err?.message?.includes("logged out")
          ? DisconnectReason.loggedOut
          : "unknown");

      // Motivos comuns: loggedOut, connectionLost, restartRequired, timedOut etc.
      await notifyDown({
        reason: `connection=close code=${code}`,
        meta: { lib: "baileys", code, msg: err?.message }
      });

      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.warn("[baileys] Conexão fechada. Reconnect?", shouldReconnect);
      if (shouldReconnect) {
        // pequeno backoff
        setTimeout(() => boot().catch(console.error), 2_000);
      }
    }
  });

  // ---------------------------
  // Mensagens (upsert)
  // ---------------------------
  sock.ev.on("messages.upsert", async ({ type, messages }) => {
    try {
      if (!messages?.length) return;
      const msg = messages[0];
      if (!msg?.key) return;

      const from = msg.key.remoteJid;
      // Ignora status e mensagens do próprio bot
      if (!from || from.endsWith("@status") || msg.key.fromMe) return;

      // Texto simples
      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.imageMessage?.caption
        || msg.message?.videoMessage?.caption
        || "";

      const hasMedia = Boolean(
        msg.message?.imageMessage ||
        msg.message?.videoMessage ||
        msg.message?.audioMessage ||
        msg.message?.documentMessage ||
        msg.message?.stickerMessage
      );

      // Sinaliza atividade (chegou mensagem)
      beat();

      if (typeof _onMessageHandler === "function") {
        await _onMessageHandler({
          from,
          text,
          hasMedia,
          raw: msg
        });
      }
    } catch (err) {
      console.error("[baileys][messages.upsert][err]", err);
    }
  });
}
