// --- Baileys import robusto (ESM/CJS-safe) ---
import * as _baileys from '@whiskeysockets/baileys'

import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys'

// tenta extrair a função de vários formatos possíveis
const makeWASocket =
  _baileys?.default?.default ||
  _baileys?.default ||
  _baileys?.makeWASocket ||
  _baileys

const { useMultiFileAuthState } = _baileys

// (Opcional) debug rápido — pode remover depois
console.log('[WPP][debug] typeof makeWASocket =', typeof makeWASocket)


let sock = null
let authReady = false
let lastQrDataURL = null

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

// Helpers para o servidor HTTP
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
    printQRInTerminal: true // em prod você pode usar a rota /qr
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
