import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createCheckoutSession, createPortalSession } from '@boilerplate/billing/stripe'
import { PLANS } from '@boilerplate/billing'
import { prisma } from '@boilerplate/database/client'
import { createServiceRoleClient } from '@boilerplate/auth/server'

async function requireAuth(request: any, reply: any) {
  const token = (request.headers.authorization ?? '').replace('Bearer ', '')
  if (!token) return reply.code(401).send({ error: 'Token ausente' })

  const supabase = createServiceRoleClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) return reply.code(401).send({ error: 'Token inválido' })

  request.userId = user.id
  request.userEmail = user.email
}

const checkoutBody = z.object({
  priceId: z.string(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
})

const portalBody = z.object({
  returnUrl: z.string().url(),
})

export async function billingRoutes(app: FastifyInstance) {
  // GET /billing/plans
  app.get('/plans', async () => Object.values(PLANS))

  // GET /billing/subscription
  app.get('/subscription', { preHandler: requireAuth }, async (request: any) => {
    const sub = await prisma.subscription.findUnique({ where: { userId: request.userId } })
    return sub ?? { planId: 'free', status: 'active' }
  })

  // POST /billing/checkout
  app.post('/checkout', { preHandler: requireAuth }, async (request: any, reply) => {
    const body = checkoutBody.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const result = await createCheckoutSession({
      userId: request.userId,
      userEmail: request.userEmail,
      ...body.data,
    })

    if (result.error) return reply.code(500).send({ error: result.error })
    return result.data
  })

  // POST /billing/portal
  app.post('/portal', { preHandler: requireAuth }, async (request: any, reply) => {
    const body = portalBody.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const sub = await prisma.subscription.findUnique({ where: { userId: request.userId } })
    if (!sub) return reply.code(404).send({ error: 'Sem assinatura ativa' })

    const result = await createPortalSession({
      stripeCustomerId: sub.stripeCustomerId,
      returnUrl: body.data.returnUrl,
    })

    if (result.error) return reply.code(500).send({ error: result.error })
    return result.data
  })
}
