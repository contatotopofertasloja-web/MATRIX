// configs/bots/claudia/flow/index.js
// Router da Cláudia: funil completo com atalhos inteligentes.
// Prioridade de decisão:
// 1) Pós-venda (pagamento confirmado)
// 2) Fechamento (comprar/checkout/link)
// 3) Oferta (preço/valor/quanto custa)
// 4) Qualificação (fala de cabelo sem pedir preço)
// 5) Greet (saudação/primeiro toque)
//
// Observação: mesmo usando funil completo, não deixamos o greet engolir
// mensagens como “quanto custa?” ou “manda o link”, que são atalhos válidos.

import greet from './greet.js';
import qualify from './qualify.js';
import offer from './offer.js';
import close from './close.js';
import postsale from './postsale.js';

// ---- Helpers ---------------------------------------------------------------

function stripAccents(s = '') {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function clean(text = '') {
  return stripAccents(String(text || '').toLowerCase()).replace(/\s+/g, ' ').trim();
}

// Sinais (bem abrangentes, sem “comer” casos do funil)
const RX = {
  postsale: /\b(paguei|pagamento\s*feito|pago|comprovante|finalizei|finalizado)\b/i,
  close:    /\b(checkout|finalizar|finaliza(r)?|fechar|fechamento|compra(r)?|carrinho|link(\s*de)?\s*pagamento|manda\s*o\s*link|quero\s*comprar)\b/i,
  offer:    /\b(preco|preço|quanto\s*custa|valor|tem\s*desconto|promocao|promo(ção)?)\b/i,
  qualify:  /\b(liso|ondulado|cachead[oa]|crespo|frizz|volume|oleos[oa]|ressecad[oa]|quebradic[eo]?|queda|alinhamento|selagem)\b/i,
  greet:    /\b(oi|ol[áa]|ola|bom\s*dia|boa\s*tarde|boa\s*noite|hey|fala|eai|e\s*a[ií])\b/i,
};

// Para quem quiser iterar flows com .match() também
const ordered = [greet, qualify, offer, close, postsale];

// ---- Router principal -------------------------------------------------------

export function pickFlow(text = '') {
  const t = clean(text);

  // 1) Pós-venda (pago/confirmado) — sempre ganha
  if (RX.postsale.test(t)) return postsale;

  // 2) Fechamento (comprar/checkout/link) — atalho válido
  if (RX.close.test(t)) return close;

  // 3) Oferta (preço/valor/quanto custa) — atalho válido
  if (RX.offer.test(t)) return offer;

  // 4) Qualificação (fala de cabelo, dor/estado) — se não pediu preço/fechar
  if (RX.qualify.test(t)) return qualify;

  // 5) Saudações / primeira mensagem
  if (RX.greet.test(t) || t.length <= 12) return greet;

  // 6) Opcional: tentativa de usar .match dos flows (caso você refine neles)
  for (const f of [qualify, offer, close, postsale, greet]) {
    try {
      if (typeof f?.match === 'function' && f.match(text)) return f;
    } catch {}
  }

  // 7) Fallback
  return greet;
}

export default ordered;
