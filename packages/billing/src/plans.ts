import type { Plan } from './types'

export const PLANS: Record<string, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Para começar',
    priceMonthly: 0,
    priceYearly: 0,
    stripePriceIdMonthly: '',
    stripePriceIdYearly: '',
    features: ['1 bot', '500 mensagens/mês', 'Suporte via email'],
    limits: { bots: 1, messagesPerMonth: 500, teamMembers: 1 },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'Para pequenas equipes',
    priceMonthly: 4900,
    priceYearly: 47040,
    stripePriceIdMonthly: process.env.STRIPE_PRICE_STARTER_MONTHLY ?? '',
    stripePriceIdYearly: process.env.STRIPE_PRICE_STARTER_YEARLY ?? '',
    features: ['3 bots', '5.000 mensagens/mês', 'Integrações básicas', 'Suporte prioritário'],
    limits: { bots: 3, messagesPerMonth: 5000, teamMembers: 3 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'Para negócios em crescimento',
    priceMonthly: 9900,
    priceYearly: 95040,
    stripePriceIdMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? '',
    stripePriceIdYearly: process.env.STRIPE_PRICE_PRO_YEARLY ?? '',
    features: ['10 bots', '50.000 mensagens/mês', 'Todas as integrações', 'Analytics avançado', 'Suporte 24/7'],
    limits: { bots: 10, messagesPerMonth: 50000, teamMembers: 10 },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Escala ilimitada',
    priceMonthly: 29900,
    priceYearly: 287040,
    stripePriceIdMonthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY ?? '',
    stripePriceIdYearly: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY ?? '',
    features: ['Bots ilimitados', 'Mensagens ilimitadas', 'SLA garantido', 'Onboarding dedicado', 'API privada'],
    limits: {},
  },
}

export function getPlanByPriceId(priceId: string): Plan | null {
  return Object.values(PLANS).find(
    (p) => p.stripePriceIdMonthly === priceId || p.stripePriceIdYearly === priceId
  ) ?? null
}
