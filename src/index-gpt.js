// src/index-gpt.js
import * as baileys from '@whiskeysockets/baileys'
import qrcode from 'qrcode'
import path from 'node:path'
import * as adapter from './adapters/whatsapp/index.js';


// --- helpers de digitação ---
const TYPING_MS_PER_CHAR = Number(process.env.TYPING_MS_PER_CHAR || 35)
const TYPING_MIN_MS      = Number(process.env.TYPING_MIN_MS || 800)
const TYPING_MAX_MS      = Number(process.env.TYPING_MAX_MS || 5000)

function calcTypingMs(text) {
  const n = Math.max(1, String(text || '').length)
  return Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, n * TYPING_MS_PER_CHAR))
}
const delay = (ms) => new Promise(r => setTimeout(r, ms))
async function simulateTyping(socket, to, text) {
  try {
    await socket.presenceSubscribe(to)
    await socket.sendPresenceUpdate('composing', to)
    await delay(calcTypingMs(text))
    await socket.sendPresenceUpdate('paused', to)
  } catch (e) {
    console.warn('[WPP][typing]', e?.message || e)
  }
}

// -------- resolver makeWASocket --------
function resolveMakeWASocket(mod) {
  if (!mod) return null
  if (typeof mod === 'function') return mod
  if (typeof mod.default === 'function') return mod.default
  if (typeof mod.makeWASocket === 'function') return mod.makeWASocket
  if (mod.default && typeof mod.default.makeWASocket === 'function') {
    return mod.default.makeWASocket
  }
  return null
}

const makeWASocket = resolveMakeWASocket(baileys)
const { useMultiFileAuthState, fetchLatestBaileysVersion } = baileys

if (typeof makeWASocket !== 'function') {
  throw new Error('Falha ao resolver makeWASocket de @whiskeysockets/baileys')
}

// -------- estado interno --------
let sock = null
let authReady = false
let lastQrDataURL = null
let reconnecting = false

// -------- adapter público --------
export const adapter = {
  async sendMessage(to, text) {
    if (!sock) throw new Error('Baileys não inicializado')
    const jid = normalizeJid(to)
    await simulateTyping(sock, jid, text)
    await sock.sendMessage(jid, { text: String(text) })
  },

  async sendImage(to, url, caption = '') {
    if (!sock) throw new Error('Baileys não inicializado')
    const jid = normalizeJid(to)
    await simulateTyping(sock, jid, caption || url)
    await sock.sendMessage(jid, { image: { url: String(url) }, caption: String(caption) })
  },

  onMessage(handler) {
    // apenas registra o handler → quem envia é o index.js
    startBaileys(async ({ from, text, hasMedia }) => {
      if (typeof handler === 'function') {
        return handler({ from, text, hasMedia })
      }
    })
  }
}

// helpers pros endpoints HTTP
export function getQrDataURL() {
  return lastQrDataURL
}
export function isReady() {
  return authReady && !!sock
}

// -------- implementação --------
async function startBaileys(onMessage) {
  const baseDir = process.env.WPP_AUTH_DIR || '/app/baileys-auth-v2'
  const session = process.env.WPP_SESSION || 'default'
  const authDir = path.join(baseDir, session)

  console.log(`[WPP] Iniciando com WPP_AUTH_DIR=${authDir}`)

  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    browser: ['Matrix', 'Chrome', '120.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    defaultQueryTimeoutMs: 60_000,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 20_000
  })

  if (state?.creds?.me?.id) {
    console.log(`[WPP] Sessão carregada! Número: ${state.creds.me.id}`)
  } else {
    console.log('[WPP] Nenhuma sessão encontrada → será gerado QR')
  }

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update || {}

    if (qr) {
      try {
        lastQrDataURL = await qrcode.toDataURL(qr)
        console.log('[WPP] QRCode atualizado')
      } catch (e) {
        console.log('[WPP] Falha ao gerar dataURL do QR:', e)
      }
    }

    if (connection === 'open') {
      authReady = true
      lastQrDataURL = null
      reconnecting = false
      console.log('[WPP] Conectado com sucesso 🎉')
    }

    if (connection === 'close') {
      authReady = false
      const reason =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.message ||
        lastDisconnect?.error ||
        'desconhecido'
      console.log('[WPP] Conexão fechada ❌ Motivo:', reason)

      if (!reconnecting) {
        reconnecting = true
        const waitMs = 3_000
        console.log(`[WPP] Tentando reconectar em ${waitMs}ms...`)
        setTimeout(() => {
          startBaileys(onMessage).catch(err =>
            console.error('[WPP] Falha no re-start:', err)
          )
        }, waitMs)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages && messages[0]
    if (!msg || !msg.message) return

    const from = msg.key.remoteJid
    const text =
      msg.message.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      ''

    const hasMedia = !!(
      msg.message.imageMessage ||
      msg.message.videoMessage ||
      msg.message.documentMessage ||
      msg.message.audioMessage ||
      msg.message.stickerMessage ||
      msg.message.viewOnceMessage
    )

    console.log(`[WPP] Mensagem de ${from}: ${text || '[mídia]'}`)

    if (onMessage) {
      try {
        // ⚠️ importante: NÃO enviar aqui → só repassa pro index.js
        await onMessage({ from, text, hasMedia })
      } catch (e) {
        console.error('[WPP][handler][ERR]', e)
      }
    }
  })
}

function normalizeJid(to) {
  return String(to).replace(/[^0-9]/g, '') + '@s.whatsapp.net'
}
