// configs/bots/maria/flow/index.js
// Router leve dos flows da Maria — prioriza offer/close antes do greet.

import greet from './greet.js';
import qualify from './qualify.js';
import offer from './offer.js';
import close from './close.js';
import postsale from './postsale.js';

// Ordem de avaliação IMPORTA:
// 1) pós-venda (gatilho "paguei")
// 2) fechamento (comprar/fechar/checkout/link)
// 3) oferta (preço/valor/quanto custa/link/checkout)
// 4) qualificação (quando fala de cabelo sem pedir preço)
// 5) greet (saudação/primeira mensagem)
const ordered = [postsale, close, offer, qualify, greet];

export function pickFlow(text = '') {
  const t = String(text || '').trim();
  for (const f of ordered) {
    try {
      if (typeof f?.match === 'function' && f.match(t)) return f;
    } catch {}
  }
  return greet; // fallback seguro
}

export default ordered;
