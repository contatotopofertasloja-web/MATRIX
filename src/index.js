import express from 'express'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'

// Import direto do adapter em TS (mantemos como você já está usando)
import { adapter } from './adapters/whatsapp/baileys/index.ts'
import { getQrDataURL, isReady } from './adapters/whatsapp/baileys/index.ts'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || '0.0.0.0'
const WEBHOOK_TOKEN = (process.env.WEBHOOK_TOKEN || '').trim()

app.use(express.json())

// Rate limit básico
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false
  })
)

// Proteção opcional por token simples (use para /send e /send-image)
function requireToken(req, res, next) {
  if (!WEBHOOK_TOKEN) return next()
  const token = (req.headers['x-api-token'] || req.query.token || '').toString()
  if (token !== WEBHOOK_TOKEN) return res.status(401).json({ error: 'unauthorized' })
  next()
}

// ---------- ROTAS "NUAS" (sem prefixo) ----------
app.get('/health', (req, res) => {
  res.json({ ok: true, wppReady: isReady() })
})

app.get('/qr', (req, res) => {
  const dataUrl = getQrDataURL()
  // Se já está conectado, não há QR — 204 é esperado
  if (!dataUrl || isReady()) return res.status(204).send()
  const base64 = dataUrl.split(',')[1]
  const img = Buffer.from(base64, 'base64')
  res.setHeader('Content-Type', 'image/png')
  res.send(img)
})

app.post('/send', requireToken, async (req, res) => {
  try {
    const { to, text } = req.body || {}
    if (!to || !text) return res.status(400).json({ error: 'to e text são obrigatórios' })
    await adapter.sendMessage(String(to), String(text))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

app.post('/send-image', requireToken, async (req, res) => {
  try {
    const { to, url, caption } = req.body || {}
    if (!to || !url) return res.status(400).json({ error: 'to e url são obrigatórios' })
    await adapter.sendImage(String(to), String(url), caption ? String(caption) : undefined)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ---------- ESPELHO EM /wpp/* ----------
const router = express.Router()
router.get('/health', (req, res) => res.redirect(307, '/health'))
router.get('/qr', (req, res) => res.redirect(307, '/qr'))
router.post('/send', requireToken, (req, res) => res.redirect(307, '/send'))
router.post('/send-image', requireToken, (req, res) => res.redirect(307, '/send-image'))
app.use('/wpp', router)

// Liga o Baileys: pipeline de mensagens
adapter.onMessage(async ({ from, text }) => {
  // TODO: plugar flows/NLU aqui
  if (!text) return
  if (/^ping$/i.test(text)) return 'pong'
})

app.listen(PORT, HOST, () => {
  console.log(`[HTTP] running on ${PORT}`)
})
