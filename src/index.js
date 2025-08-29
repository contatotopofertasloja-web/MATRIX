import express from 'express'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'

// Adapter Baileys (já com QR, versão e flags estáveis)
import {
  adapter,
  getQrDataURL,
  isReady
} from './adapters/whatsapp/baileys/index.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || '0.0.0.0'
const WEBHOOK_TOKEN = (process.env.WEBHOOK_TOKEN || '').trim()

// Estamos atrás de proxy (Railway/Ingress) → necessário para express-rate-limit
app.set('trust proxy', 1)

// Middlewares básicos
app.use(express.json())
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 300,                  // 300 req/15min por IP
    standardHeaders: true,
    legacyHeaders: false
  })
)

// Proteção opcional por token (para /send e /send-image)
function requireToken(req, res, next) {
  if (!WEBHOOK_TOKEN) return next()
  const token = String(req.headers['x-api-token'] || req.query.token || '')
  if (token !== WEBHOOK_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
}

// ---------- ROTAS ----------
app.get('/health', (_req, res) => {
  res.json({ ok: true, wppReady: isReady() })
})

app.get('/qr', (_req, res) => {
  const dataUrl = getQrDataURL()
  // Se já conectou, não há QR — 204 é esperado
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

// Liga o Baileys para receber mensagens
adapter.onMessage(async ({ from, text }) => {
  if (!text) return
  if (/^ping$/i.test(text)) return 'pong'
  // TODO: plugar flows/NLU aqui
})

app.listen(PORT, HOST, () => {
  console.log(`[HTTP] running on ${PORT}`)
})
