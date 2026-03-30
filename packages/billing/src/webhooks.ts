import Stripe from 'stripe'

export function constructWebhookEvent(payload: string | Buffer, signature: string): Stripe.Event {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY não configurada')
  if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET não configurada')

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

  return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET)
}

export type WebhookHandler = (event: Stripe.Event) => Promise<void>

// Tipos de evento que o sistema trata
export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
] as const

export type HandledEventType = (typeof HANDLED_EVENTS)[number]

export function isHandledEvent(type: string): type is HandledEventType {
  return HANDLED_EVENTS.includes(type as HandledEventType)
}
