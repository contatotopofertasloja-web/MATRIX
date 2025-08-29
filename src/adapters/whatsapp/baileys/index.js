// ---------- Imports robustos ----------
import * as baileys from '@whiskeysockets/baileys'
import qrcode from 'qrcode'

// Resolver para diferentes formatos de export do Baileys (ESM/CJS)
function resolveMakeWASocket(mod) {
  if (!mod) return null
  // function direta
  if (typeof mod === 'function') return mod
  // default é função
  if (typeof mod.default === 'function') return mod.default
  // export nomeado
  if (typeof mod.makeWASocket === 'function') return mod.makeWASocket
  // default contém a função como propriedade
  if (mod.default && typeof mod.default.makeWASocket === 'function') {
    return mod.default.makeWASocket
  }
  return null
}

const makeWASocket = resolveMakeWASocket(baileys)
const { useMultiFileAuthState } = baileys

console.log('[WPP][debug] resolved makeWASocket type =', typeof makeWASocket)
if (typeof makeWASocket !== 'function') {
  throw new Error('Falha ao resolver makeWASocket a partir de @whiskeysockets/baileys')
}

// ---------- Estado ----------
let sock = null
let authReady = false
let lastQrDataURL = null

// ---------- Adapter público ----------
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

// Helpers expostos para HTTP
export function getQrDataURL() {
  return lastQrDataURL
}

export function isReady() {
  return authReady && !!sock
}

// ---------- Internals ----------
async function startBaileys(onMessage) {
  const authDir = process.env.WPP_AUTH_DIR || './.wpp-auth'
  console.log(`[WPP] Iniciando com WPP_AUTH_DIR=${authDir}`)

  const { state, saveCreds } = await useMultiFileAuthState(authDir)

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true // você também pode pegar o QR via /qr
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
    } else if (connection === 'close') {
      authReady = false
      console.log('[WPP] Conexão fechada ❌', lastDisconnect?.error)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages && messages[0]
    if (!msg || !msg.message) return

    const from = msg.key.remoteJid
    const text =
      msg.message.conversation ||
      (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) ||
      (msg.message.imageMessage && msg.message.imageMessage.caption) ||
      ''

    const hasMedia = !!(msg.message.imageMessage || msg.message.videoMessage || msg.message.documentMessage)

    console.log(`[WPP] Mensagem de ${from}: ${text}`)
    if (onMessage) await onMessage({ from, text, hasMedia })
  })
}

function normalizeJid(to) {
  const digits = String(to).replace(/\D/g, '')
  if (digits.endsWith('@s.whatsapp.net')) return digits
  return `${digits}@s.whatsapp.net`
}
