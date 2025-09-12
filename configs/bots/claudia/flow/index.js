// flow/index.js — roteador simples

import greet from './greet.js';
import qualify from './qualify.js';
import offer from './offer.js';
import objections from './objections.js';
import close from './close.js';
import postsale from './postsale.js';
import faq from './faq.js';
import { isAwaitingConsent } from './_state.js';

function stripAccents(s=''){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function clean(t=''){return stripAccents(String(t||'').toLowerCase()).replace(/\s+/g,' ').trim();}

const RX = {
  postsale: /\b(paguei|pagamento\s*feito|pago|comprovante|finalizei|finalizado)\b/i,
  close:    /\b(checkout|finalizar|finaliza(r)?|fechar|fechamento|compra(r)?|carrinho|manda\s*o\s*link|quero\s*comprar)\b/i,
  offer:    /\b(preco|preço|quanto\s*custa|valor|desconto|promo(cao|ção)|oferta)\b/i,
};

export const ordered = [greet, qualify, objections, offer, close, postsale, faq];

export function pickFlow(text = '', settings = {}, jid = '') {
  const t = clean(text);

  if (RX.postsale.test(t)) return postsale;
  if (isAwaitingConsent(jid) || RX.close.test(t)) return close;
  if (RX.offer.test(t))    return offer;
  if (typeof objections.match === 'function' && objections.match(text, settings)) return objections;
  if (typeof faq.match === 'function' && faq.match(text, settings)) return faq;
  if (typeof qualify.match === 'function' && qualify.match(text))   return qualify;

  return greet;
}

export default ordered;
