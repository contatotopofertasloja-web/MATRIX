// Roteador da Cláudia (prioriza pós-venda → close → faq → offer → objections → qualify → greet)

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
  close:    /\b(checkout|finalizar|finaliza(r)?|fechar|fechamento|compra(r)?|carrinho|manda\s*o\s*link|quero\s*comprar)\b/i,
  offer:    /\b(preco|preço|quanto\s*custa|valor|desconto|promo(cao|ção)|oferta)\b/i,
};

// a ordem exportada é apenas referencial; o pickFlow é quem manda
export const ordered = [greet, qualify, objections, faq, offer, close, postsale];

export function pickFlow(text = '', settings = {}, jid = '') {
  const t = clean(text);

  // 1) pós-venda e fechamento têm prioridade máxima
  if (RX.postsale.test(t)) return postsale;
  if (isAwaitingConsent(jid) || RX.close.test(t)) return close;

  // 2) >>> DÊ CHANCE AO FAQ ANTES DA OFERTA <<<
  //    Isso garante que perguntas objetivas ("qual é o nome do produto/empresa/horário?")
  //    caiam no fluxo determinístico do FAQ, e não na oferta.
  if (typeof faqMatch === 'function' && faqMatch(text, settings)) return faq;

  // 3) oferta e objeções
  if (RX.offer.test(t)) return offer;
  if (typeof objections.match === 'function' && objections.match(text, settings)) return objections;

  // 4) qualificação padrão
  if (typeof qualify.match === 'function' && qualify.match(text))   return qualify;

  // 5) saudação fallback
  return greet;
}

export function __route(text = '', settings = {}, jid = '') {
  return pickFlow(text, settings, jid);
}

export default ordered;
