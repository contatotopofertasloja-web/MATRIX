import { NextRequest, NextResponse } from 'next/server'
import { constructWebhookEvent, isHandledEvent } from '@boilerplate/billing/webhooks'
import { prisma } from '@boilerplate/database/client'
import { getPlanByPriceId } from '@boilerplate/billing/stripe'
import type Stripe from 'stripe'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) return NextResponse.json({ error: 'Sem signature' }, { status: 400 })

  let event: Stripe.Event

  try {
    event = constructWebhookEvent(body, signature)
  } catch {
    return NextResponse.json({ error: 'Webhook inválido' }, { status: 400 })
  }

  if (!isHandledEvent(event.type)) {
    return NextResponse.json({ received: true })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription') break

        const userId = session.metadata?.userId
        if (!userId) break

        await prisma.subscription.upsert({
          where: { userId },
          create: {
            userId,
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: session.subscription as string,
            stripePriceId: '',
            planId: 'starter',
            status: 'active',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
          update: {
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: session.subscription as string,
          },
        })
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription
        const priceId = sub.items.data[0]?.price.id
        const plan = priceId ? getPlanByPriceId(priceId) : null

        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: {
            stripePriceId: priceId ?? '',
            planId: plan?.id ?? 'starter',
            status: sub.status as any,
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          },
        })
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { status: 'canceled' },
        })
        break
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
