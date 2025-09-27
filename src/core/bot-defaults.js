// src/core/bot-defaults.js — defaults genéricos para bots (neutro)
import { settings } from './settings.js';

function getPersona() {
  return settings?.persona_name || process.env.BOT_PERSONA_NAME || 'Atendente';
}
function getPrice() {
  return Number(settings?.product?.price_target) || Number(process.env.PRICE_TARGET) || 0;
}
function getCheckout() {
  return settings?.product?.checkout_link || process.env.CHECKOUT_LINK || '';
}

export async function safeBuildPrompt({ stage, message } = {}) {
  const persona  = getPersona();
  const price    = getPrice();
  const checkout = getCheckout();

  const system = [
    `Você é ${persona}, educada e objetiva. PT-BR.`,
    'Existe um produto principal. Não invente produtos, preços ou links.',
    (price ? `Preço promocional: R$ ${price}.` : '').trim(),
    (checkout ? `Link seguro: ${checkout}.` : '').trim(),
    'Se perguntarem preço → responda com objetividade e ofereça o link quando apropriado.',
    'Se houver objeção → responda com segurança e clareza, sem prometer o que não temos.',
  ].filter(Boolean).join(' ');

  const user = String(message || '');
  return { system, user };
}

export async function fallbackText() {
  const price    = getPrice();
  const checkout = getCheckout();
  const linkPart = checkout ? ` (${checkout})` : '';
  const pricePart = price ? `Promo: R$ ${price}. ` : '';
  return `${pricePart}Posso te enviar o link para finalizar${linkPart}?`;
}

export async function openingMedia() {
  if (settings?.flags?.send_opening_photo && settings?.media?.opening_photo_url) {
    return { url: settings.media.opening_photo_url, caption: '' };
  }
  return null;
}

export async function onPaymentConfirmed({ jid, send }) {
  try {
    for (const line of settings?.messages?.postsale_pre_coupon ?? []) { await send(jid, line); }
    if (settings?.product?.coupon_post_payment_only && settings?.product?.coupon_code) {
      const tpl = settings?.messages?.postsale_after_payment_with_coupon?.[0] || '';
      const txt = tpl.replace('{{coupon_code}}', settings.product.coupon_code);
      if (txt) await send(jid, txt);
    }
  } catch (e) { console.error('[bot-defaults][onPaymentConfirmed]', e?.message || e); }
}

export const hooks = { safeBuildPrompt, fallbackText, openingMedia, onPaymentConfirmed };
export default hooks;
