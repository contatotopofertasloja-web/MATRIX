import Stripe from 'stripe'
import type { CheckoutParams, PortalParams, BillingResult } from './types'

function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY não configurada')
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
}

export async function createCheckoutSession(
  params: CheckoutParams
): Promise<BillingResult<{ url: string }>> {
  try {
    const stripe = getStripe()

    // Garante ou cria customer no Stripe
    let customerId: string
    const existing = await stripe.customers.list({ email: params.userEmail, limit: 1 })

    if (existing.data.length > 0) {
      customerId = existing.data[0].id
    } else {
      const customer = await stripe.customers.create({
        email: params.userEmail,
        metadata: { userId: params.userId },
      })
      customerId = customer.id
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: params.priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      subscription_data: {
        trial_period_days: params.trialDays,
        metadata: { userId: params.userId },
      },
      metadata: { userId: params.userId },
    })

    return { data: { url: session.url! }, error: null }
  } catch (err) {
    return { data: null, error: (err as Error).message }
  }
}

export async function createPortalSession(
  params: PortalParams
): Promise<BillingResult<{ url: string }>> {
  try {
    const stripe = getStripe()

    const session = await stripe.billingPortal.sessions.create({
      customer: params.stripeCustomerId,
      return_url: params.returnUrl,
    })

    return { data: { url: session.url }, error: null }
  } catch (err) {
    return { data: null, error: (err as Error).message }
  }
}

export async function cancelSubscription(
  stripeSubscriptionId: string
): Promise<BillingResult> {
  try {
    const stripe = getStripe()
    await stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true })
    return { data: null, error: null }
  } catch (err) {
    return { data: null, error: (err as Error).message }
  }
}

export async function getSubscription(stripeSubscriptionId: string) {
  const stripe = getStripe()
  return stripe.subscriptions.retrieve(stripeSubscriptionId)
}
