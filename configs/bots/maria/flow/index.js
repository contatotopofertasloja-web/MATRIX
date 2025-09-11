// configs/bots/maria/flow/index.js
import greet from './greet.js';
import qualify from './qualify.js';
import offer from './offer.js';
import close from './close.js';
import postsale from './postsale.js';
import faq from './faq.js';

function stripAccents(s = '') {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function clean(text = '') {
  return stripAccents(String(text || '').toLowerCase()).replace(/\s+/g, ' ').trim();
}

const RX = {
  postsale: /\b(paguei|pagamento\s*feito|pago|comprovante|finalizei|finalizado)\b/i,
  close:    /\b(checkout|finalizar|finaliza(r)?|fechar|fechamento|compra(r)?|carrinho|manda\s*o\s*link|quero\s*comprar)\b/i,
  offer:    /\b(preco|preço|quanto\s*custa|valor|desconto|promo(cao|ção)|oferta)\b/i,
  greet:    /\b(oi|ol[áa]|ola|bom\s*dia|boa\s*tarde|boa\s*noite|hey|fala|eai|e\s*a[ií])\b/i,
};

export const ordered = [greet, qualify, offer, close, postsale, faq];

export function pickFlow(text = '', settings = {}) {
  const t = clean(text);

  if (RX.postsale.test(t)) return postsale;
  if (RX.close.test(t))    return close;
  if (RX.offer.test(t))    return offer;

  if (typeof faq.match === 'function' && faq.match(text, settings)) return faq;

  if (typeof qualify.match === 'function' && qualify.match(text)) return qualify;
  if (RX.greet.test(t) || t.length <= 12) return greet;

  for (const f of [qualify, faq, offer, close, postsale, greet]) {
    try {
      if (typeof f?.match === 'function' && f.match(text, settings)) return f;
    } catch {}
  }
  return greet;
}

export default ordered;
