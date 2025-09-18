// configs/bots/claudia/flow/router.js
// Router ÚNICO: decide o fluxo com base no texto + estado.
// Prioridade: pós-venda → fechamento → FAQ → oferta → objeções → qualificação → saudação.

import greet from './greet.js';
import qualify from './qualify.js';
import offer from './offer.js';
import objections, { match as objectionsMatch } from './objections.js';
import close from './close.js';
import postsale from './postsale.js';
import faq, { match as faqMatch } from './faq.js';
import { isAwaitingConsent } from './_state.js';

function stripAccents(s = '') {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function clean(t = '') {
  return stripAccents(String(t || '').toLowerCase()).replace(/\s+/g, ' ').trim();
}

const RX = {
  postsale: /\b(paguei|pagamento\s*feito|pago|comprovante|finalizei|finalizado)\b/i,
  close:    /\b(checkout|finalizar|finaliza(r)?|fechar|fechamento|compra(r)?|carrinho|manda\s*o\s*link|quero\s*comprar|pedido)\b/i,
  offer:    /\b(preco|preço|quanto\s*custa|valor|desconto|promo(cao|ção)|oferta|cust[ao])\b/i,
};

export const ordered = [postsale, close, faq, offer, objections, qualify, greet];

export function pickFlow(text = '', settings = {}, state = {}) {
  const t = clean(text);

  // 1) Pós-venda e fechamento primeiro
  if (RX.postsale.test(t)) return postsale;
  if (isAwaitingConsent(state) || RX.close.test(t)) return close;

  // 2) FAQ determinístico
  try { if (typeof faqMatch === 'function' && faqMatch(text, settings)) return faq; } catch {}

  // 3) Oferta e objeções
  if (RX.offer.test(t)) return offer;
  try { if (typeof objectionsMatch === 'function' && objectionsMatch(text, settings)) return objections; } catch {}

  // 4) Qualificação (leve)
  if (/\b(liso|ondulado|cachead[oa]|crespo|frizz|volume)\b/i.test(t)) return qualify;

  // 5) Saudação
  if (/\b(oi|ol[áa]|bom\s*dia|boa\s*tarde|boa\s*noite|hey|hi|hello)\b/i.test(t)) return greet;

  // Default
  return qualify;
}
