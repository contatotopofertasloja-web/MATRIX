// configs/bots/claudia/flow/index.js
// Router do bot: mapeia estágios para handlers.
// Pontos-chave:
// - Alias explícito: "recepcao" → greet (evita silêncio no 1º "oi")
// - handle() faz fallback para greet
// - Mantém demais flows plug & play

import greet from './greet.js';
import qualify from './qualify.js';
import offer from './offer.js';
import faq from './faq.js';
import objections from './objections.js';
import close from './close.js';
import postsale from './postsale.js';

export { greet, qualify, offer, faq, objections, close, postsale };

// Alias explícitos de estágio → handler
export const recepcao     = greet;        // <- importante: 1º turno cai aqui
export const qualificacao = qualify;
export const oferta       = offer;
export const objecoes     = objections;
export const fechamento   = close;
export const posvenda     = postsale;

// Fallback leve por intenção/estágio
export async function handle(ctx = {}) {
  const t = String(ctx?.text || '').toLowerCase();

  // Rotas diretas por palavras-chave (opcional, simples)
  if (/pre[cç]o|valor|quanto|cust/.test(t)) return offer(ctx);
  if (/entrega|frete|prazo/.test(t)) return faq(ctx);
  if (/caro|alerg|parcel|vou pensar|depois/.test(t)) return objections(ctx);
  if (/fechar|checkout|link|compr(ar|a)/.test(t)) return close(ctx);

  // Sem intenção clara → sempre comece pelo greet
  return greet(ctx);
}

// Export default com todos handlers (esperado pelo loader)
export default {
  recepcao,
  greet,
  handle,
  qualificacao,
  oferta,
  objecoes,
  fechamento,
  posvenda,
  faq,
  qualify,   // aliases adicionais
  offer,
  close,
  postsale,
};
