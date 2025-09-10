// src/core/bot-defaults.js
// Defaults de “bot hooks” — genéricos. Nenhuma referência a nomes próprios.
// Tudo que é identidade vem de settings (persona_name, produto, links).

import { settings } from './settings.js';

function getPersona() {
  return settings?.persona_name || process.env.BOT_PERSONA_NAME || 'Atendente de Vendas';
}
function getPrice() {
  return settings?.product?.price_target || Number(process.env.PRICE_TARGET) || 170;
}
function getCheckout() {
  return settings?.product?.checkout_link || process.env.CHECKOUT_LINK || '';
}

export async function safeBuildPrompt({ stage, message } = {}) {
  const persona  = getPersona();
  const price    = getPrice();
  const checkout = getCheckout();

  const system = [
    `Você é ${persona}, vendedora educada e objetiva. Responda em PT-BR, frases curtas.`,
    'Existe UM produto principal. Não invente produtos, preços ou links.',
    `Preço promocional: R$${price}. Link seguro: ${checkout || 'indisponível'}.`,
    'Se perguntarem preço → diga R$${price} e ofereça o link.',
    'Se perguntarem como usar → explique em 2-3 linhas, simples.',
    'Se houver objeção → responda com segurança e clareza, sem prometer o que não temos.',
  ].join(' ');
  const user = String(message || '');
  return { system, user };
}

export async function fallbackText(/* { stage, message } */) {
  const price    = getPrice();
  const checkout = getCheckout();
  const linkPart = checkout ? ` (${checkout})` : '';
  return `Promo: R$${price} na entrega. Posso te mandar o link do checkout${linkPart}?`;
}

export async function openingMedia() {
  if (settings?.flags?.send_opening_photo && settings?.media?.opening_photo_url) {
    return { url: settings.media.opening_photo_url, caption: '' };
  }
  return null;
}

export async function onPaymentConfirmed({ jid, send }) {
  try {
    for (const line of settings?.messages?.postsale_pre_coupon ?? []) {
      await send(jid, line);
    }
    if (settings?.product?.coupon_post_payment_only && settings?.product?.coupon_code) {
      const tpl = settings?.messages?.postsale_after_payment_with_coupon?.[0] || '';
      const txt = tpl.replace('{{coupon_code}}', settings.product.coupon_code);
      if (txt) await send(jid, txt);
    }
  } catch (e) {
    console.error('[bot-defaults][onPaymentConfirmed]', e?.message || e);
  }
}

export const hooks = {
  safeBuildPrompt,
  fallbackText,
  openingMedia,
  onPaymentConfirmed,
};
export default hooks;
