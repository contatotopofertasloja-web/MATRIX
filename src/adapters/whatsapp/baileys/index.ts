import makeWASocket, { useMultiFileAuthState, WAMessage } from '@whiskeysockets/baileys'
import type { WhatsAppAdapter } from '../index'

let sock: ReturnType<typeof makeWASocket> | null = null
let authReady = false

export const adapter: WhatsAppAdapter = {
  async sendMessage(to, text) {
    if (!sock) throw new Error('Baileys não inicializado')
    await sock.sendMessage(to, { text })
  },

  async sendImage(to, url, caption) {
    if (!sock) throw new Error('Baileys não inicializado')
    await sock.sendMessage(to, {
      image: { url },
      caption,
    })
  },

  onMessage(handler) {
    startBaileys(handler)
  }
}

/**
 * Inicializa a sessão do Baileys
 */
async function startBaileys(
  onMessage?: (args: { from: string; text: string; hasMedia: boolean }) => void
) {
  const authDir = process.env.WPP_AUTH_DIR || './.wpp-auth'
  console.log(`[WPP] Iniciando com WPP_AUTH_DIR=${authDir}`)

  const { state, saveCreds } = await useMultiFileAuthState(authDir)

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  })

  // Sessão já existente?
  if (state.creds?.me?.id) {
    console.log(`[WPP] Sessão carregada do volume! Número: ${state.creds.me.id}`)
  } else {
    console.log('[WPP] Nenhuma sessão encontrada → será gerado QR')
  }

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update
    if (connection === 'open') {
      authReady = true
      console.log('[WPP] Conectado com sucesso 🎉')
    } else if (connection === 'close') {
      authReady = false
      console.log('[WPP] Conexão fechada ❌', lastDisconnect?.error)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg: WAMessage = messages[0]
    if (!msg.message) return

    const from = msg.key.remoteJid!
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ''
    const hasMedia = !!(msg.message.imageMessage || msg.message.videoMessage)

    console.log(`[WPP] Mensagem recebida de ${from}: ${text}`)

    if (onMessage) {
      await onMessage({ from, text, hasMedia })
    }
  })
}
