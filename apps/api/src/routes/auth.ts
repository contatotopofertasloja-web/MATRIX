import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createServiceRoleClient } from '@boilerplate/auth/server'
import { prisma } from '@boilerplate/database/client'

const bearerSchema = z.string().min(1)

// Middleware: valida JWT do Supabase e injeta userId no request
async function requireAuth(request: any, reply: any) {
  const authHeader = request.headers.authorization ?? ''
  const token = authHeader.replace('Bearer ', '')

  const parse = bearerSchema.safeParse(token)
  if (!parse.success) return reply.code(401).send({ error: 'Token ausente' })

  const supabase = createServiceRoleClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) return reply.code(401).send({ error: 'Token inválido' })

  request.userId = user.id
  request.userEmail = user.email
}

export async function authRoutes(app: FastifyInstance) {
  // GET /auth/me — retorna dados do usuário logado
  app.get('/me', { preHandler: requireAuth }, async (request: any) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId } })
    if (!user) return app.httpErrors?.notFound('Usuário não encontrado')
    return user
  })

  // POST /auth/sync — cria/atualiza user local após signup no Supabase
  app.post('/sync', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
    },
  }, async (request: any) => {
    const { name } = request.body as { name?: string }

    const user = await prisma.user.upsert({
      where: { id: request.userId },
      create: { id: request.userId, email: request.userEmail, name },
      update: { name },
    })

    return user
  })
}
