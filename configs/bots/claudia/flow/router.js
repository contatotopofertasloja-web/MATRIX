// configs/bots/claudia/flow/router.js
// Prioridade: pós-venda → close → FAQ → oferta → objeções → qualify → greet
import greet from './greet.js';
import qualify from './qualify.js';
import offer from './offer.js';
import objections from './objections.js';
import close from './close.js';
import postsale from './postsale.js';
import faq, { match as faqMatch } from './faq.js';
import { isAwaitingConsent } from './_state.js';

function stripAccents(s=''){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function clean(t=''){return stripAccents(String(t||'').toLowerCase()).replace(/\s+/g,' ').trim();}

const RX = {
  postsale: /\b(paguei|pagamento\s*feito|pago|comprovante|finalizei|finalizado)\b/i,
  close:    /\b(checkout|finalizar|finaliza(r)?|fechar|fechamento|compra(r)?|carrinho|manda\s*o\s*link|quero\s*comprar|pedido)\b/i,
  offer:    /\b(preco|preço|quanto\s*custa|valor|desconto|promo(cao|ção)|oferta|cust[ao])\b/i,
};

// ordem referencial
export const ordered = [postsale, close, faq, offer, objections, qualify, greet];

export function pickFlow(text = '', settings = {}, state = {}) {
  const t = clean(text);
  if (!t) return greet;

  // 1) pós-venda e fechamento primeiro
  if (RX.postsale.test(t)) return postsale;
  if (isAwaitingConsent(state) || RX.close.test(t)) return close; // ← bugfix: usa state

  // 2) FAQ determinístico (empresa, horário, etc.)
  if (typeof faqMatch === 'function' && faqMatch(text, settings)) return faq;

  // 3) oferta e objeções
  if (RX.offer.test(t)) return offer;
  if (typeof objections.match === 'function' && objections.match(text, settings)) return objections;

  // 4) qualificação
  if (typeof qualify.match === 'function' && qualify.match(text)) return qualify;

  // 5) saudação fallback
  return greet;
}

export function __route(text = '', settings = {}, state = {}) {
  return pickFlow(text, settings, state);
}
export default ordered;
