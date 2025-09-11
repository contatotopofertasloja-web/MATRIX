// configs/bots/maria/flow/offer.js
// Etapa: oferta. Informa preço e oferece link, respeitando guardrails.

import { settings } from '../../../../src/core/settings.js';

export const id = 'offer';
export const stage = 'oferta';

function clampPrice(p) {
  const min = Number(settings?.guardrails?.price_min ?? 0);
  const max = Number(settings?.guardrails?.price_max ?? Number.POSITIVE_INFINITY);
  return Math.max(min || 0, Math.min(max || p, p));
}

export function match(text = '') {
  const t = String(text).toLowerCase();
  return /(preco|preço|valor|quanto custa|link|checkout)/i.test(t);
}

export async function run(ctx = {}) {
  const target = Number(settings?.product?.price_target ?? 170);
  const price = clampPrice(target);
  const link = settings?.product?.checkout_link || '';

  const offerTpls = settings?.messages?.offer_templates || [
    `Consigo por R$${price} 🛒 Te mando o link do checkout?`,
  ];

  // Se cliente já pedir link explicitamente, já manda junto
  const askedLink = /(link|checkout|comprar|fechar)/i.test(String(ctx?.text || ''));

  if (askedLink && link) {
    return {
      text: `Promo: R$${price}. Aqui está o link seguro: ${link}`,
      nextStage: 'fechamento',
      actions: ['send_price', 'send_link'],
    };
  }

  return {
    text: offerTpls[0].replace('{{price_target}}', price),
    nextStage: 'fechamento',
    actions: ['send_price'],
  };
}

export default { id, stage, match, run };
