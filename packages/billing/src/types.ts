export type PlanId = 'free' | 'starter' | 'pro' | 'enterprise'

export interface Plan {
  id: PlanId
  name: string
  description: string
  priceMonthly: number   // em centavos
  priceYearly: number    // em centavos
  stripePriceIdMonthly: string
  stripePriceIdYearly: string
  features: string[]
  limits: {
    bots?: number
    messagesPerMonth?: number
    teamMembers?: number
  }
}

export interface Subscription {
  id: string
  userId: string
  stripeCustomerId: string
  stripeSubscriptionId: string
  stripePriceId: string
  planId: PlanId
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete'
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
}

export interface CheckoutParams {
  userId: string
  userEmail: string
  priceId: string
  successUrl: string
  cancelUrl: string
  trialDays?: number
}

export interface PortalParams {
  stripeCustomerId: string
  returnUrl: string
}

export interface BillingResult<T = void> {
  data: T | null
  error: string | null
}
