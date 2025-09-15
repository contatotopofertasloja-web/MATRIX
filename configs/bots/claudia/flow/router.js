// Roteador da Cláudia — prioridade: pós-venda → close → FAQ → oferta → objeções → qualify → greet
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
  close: /\b(fechar|checkout|finalizar|comprar|link|pedido|carrinho)\b/i,
  offer: /\b(oferta|promoc[aã]o|desconto|pre[cç]o|valor|quanto|cust[ao])\b/i,
};

export const ordered = [postsale, close, faq, offer, objections, qualify, greet];

export function pickFlow(text = '', settings = {}, jid = '') {
  const t = clean(text);
  if (!t) return greet;

  // 1) Pós-venda e fechamento primeiro
  if (RX.postsale.test(t)) return postsale;
  if (isAwaitingConsent(jid) || RX.close.test(t)) return close;

  // 2) FAQ (perguntas objetivas: preço, nome da empresa, horários, sorteios etc.)
  if (typeof faqMatch === 'function' && faqMatch(text, settings)) return faq;

  // 3) Oferta / objeções
  if (RX.offer.test(t)) return offer;
  if (typeof objections.match === 'function' && objections.match(text, settings)) return objections;

  // 4) Qualificação
  if (typeof qualify.match === 'function' && qualify.match(text)) return qualify;

  // 5) Saudação / fallback
  return greet;
}

export function __route(text = '', settings = {}, jid = '') {
  return pickFlow(text, settings, jid);
}
export default ordered;
