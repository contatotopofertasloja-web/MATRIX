import express from 'express'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import { adapter } from './adapters/whatsapp/baileys/index.ts' // importa o TS; Node 18+ resolve via ts-node transpile do bundler do Railway
import { getQrDataURL, isReady } from './adapters/whatsapp/baileys/index.ts'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || '0.0.0.0'
const WEBHOOK_TOKEN = (process.env.WEBHOOK_TOKEN || '').trim()

app.use(express.json())

// rate limit básico
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false
  })
)

// proteção opcional por token simples (use em /send e /send-image)
function requireToken(req, res, next) {
  if (!WEBHOOK_TOKEN) return next()
  const token = (req.headers['x-api-token'] || req.query.token || '').toString()
  if (token !== WEBHOOK_TOKEN) return res.status(401).json({ error: 'unauthorized' })
  next()
}

// health
app.get('/health', (req, res) => {
  res.json({ ok: true, wppReady: isReady() })
})

// QR como PNG
app.get('/qr', (req, res) => {
  const dataUrl = getQrDataURL()
  if (!dataUrl || isReady()) return res.status(204).send() // sem QR ou já conectado
  const base64 = dataUrl.split(',')[1]
  const img = Buffer.from(base64, 'base64')
  res.setHeader('Content-Type', 'image/png')
  res.send(img)
})

// enviar texto
app.post('/send', requireToken, async (req, res) => {
  try {
    const { to, text } = req.body || {}
    if (!to || !text) return res.status(400).json({ error: 'to e text são obrigatórios' })
    await adapter.sendMessage(to, String(text))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// enviar imagem
app.post('/send-image', requireToken, async (req, res) => {
  try {
    const { to, url, caption } = req.body || {}
    if (!to || !url) return res.status(400).json({ error: 'to e url são obrigatórios' })
    await adapter.sendImage(to, String(url), caption ? String(caption) : undefined)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// liga o Baileys: seu pipeline de mensagens
adapter.onMessage(async ({ from, text }) => {
  // TODO: plugar flows/NLU aqui
  // resposta exemplo:
  if (!text) return
  if (/^ping$/i.test(text)) return 'pong'
})

app.listen(PORT, HOST, () => {
  console.log(`[HTTP] running on ${PORT}`)
})
