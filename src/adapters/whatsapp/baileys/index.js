// src/adapters/whatsapp/baileys/index.js
import * as baileys from '@whiskeysockets/baileys'
import qrcode from 'qrcode'
import path from 'node:path'

// -------- resolver robusto para diferentes formatos de export --------
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

console.log('[WPP][debug] resolved makeWASocket type =', typeof makeWASocket)
if (typeof makeWASocket !== 'function') {
  throw new Error('Falha ao resolver makeWASocket de @whiskeysockets/baileys')
}

// -------- estado interno --------
let sock = null
let authReady = false
let lastQrDataURL = null

// -------- adapter público usado pelo app --------
export const adapter = {
  async sendMessage(to, text) {
    if (!sock) throw new Error('Baileys não inicializado')
    const jid = normalizeJid(to)
    await sock.sendMessage(jid, { text: String(text) })
  },

  async sendImage(to, url, caption = '') {
    if (!sock) throw new Error('Baileys não inicializado')
    const jid = normalizeJid(to)
    await sock.sendMessage(jid, { image: { url: String(url) }, caption: String(caption) })
  },

  onMessage(handler) {
    startBaileys(async ({ from, text, hasMedia }) => {
      if (typeof handler === 'function') {
        await handler({ from, text, hasMedia })
      }
    })
  }
}

// helpers acessados pelos endpoints HTTP
export function getQrDataURL() {
  return lastQrDataURL
}

export function isReady() {
  return authReady && !!sock
}

// -------- implementação --------
async function startBaileys(onMessage) {
  // base do diretório de sessão (respeita env e permite subpasta se quiser usar WPP_SESSION)
  const baseDir = process.env.WPP_AUTH_DIR || '/app/baileys-auth'
  const session = process.env.WPP_SESSION || 'default'
  const authDir = path.join(baseDir, session)

  console.log(`[WPP] Iniciando com WPP_AUTH_DIR=${authDir}`)

  const { state, saveCreds } = await useMultiFileAuthState(authDir)

  // força versão do WhatsApp Web suportada
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,          // QR também nos logs do Railway
    browser: ['Matrix', 'Chrome', '120.0.0'],
    markOnlineOnConnect: false,       // evita ficar "online" no pareamento
    syncFullHistory: false,           // não tenta puxar histórico completo
    defaultQueryTimeoutMs: 60_000,    // fôlego extra
  })

  if (state?.creds?.me?.id) {
    console.log(`[WPP] Sessão carregada do volume! Número: ${state.creds.me.id}`)
  } else {
    console.log('[WPP] Nenhuma sessão encontrada → será gerado QR')
  }

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

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
      msg.message.documentMessage
    )

    console.log(`[WPP] Mensagem de ${from}: ${text}`)
    if (onMessage) await onMessage({ from, text, hasMedia })
  })
}

function normalizeJid(to) {
  const digits = String(to).replace(/\D/g, '')
  if (digits.endsWith('@s.whatsapp.net')) return digits
  return `${digits}@s.whatsapp.net`
}
