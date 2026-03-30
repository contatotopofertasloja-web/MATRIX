import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { authRoutes } from './routes/auth.js'
import { billingRoutes } from './routes/billing.js'
import { healthRoutes } from './routes/health.js'

const app = Fastify({ logger: true })

// Plugins
await app.register(helmet)
await app.register(cors, {
  origin: process.env.WEB_URL ?? 'http://localhost:3000',
  credentials: true,
})
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })

// Rotas
await app.register(healthRoutes)
await app.register(authRoutes, { prefix: '/auth' })
await app.register(billingRoutes, { prefix: '/billing' })

// Start
const port = Number(process.env.PORT ?? 3001)
await app.listen({ port, host: '0.0.0.0' })
