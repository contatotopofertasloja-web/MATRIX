// configs/bots/claudia/flow/index.js
// Registry + runner da Cláudia (Matrix 2.0-ready)

import greet from './greet.js';
import qualify from './qualify.js';
import offer from './offer.js';
import objections from './objections.js';
import close from './close.js';
import postsale from './postsale.js';
import faq from './faq.js';
import router, { pickFlow, ordered } from './router.js';

export const registry = {
  greet,
  qualificacao: qualify,  // alias pt
  qualify,
  oferta: offer,          // alias pt
  offer,
  objeções: objections,   // alias acentuado
  objecoes: objections,   // alias sem acento
  objections,
  fechamento: close,      // alias pt
  close,
  posvenda: postsale,     // alias pt
  postsale,
  faq,
};

// Runner padrão: decide o flow e executa
export async function handle(ctx) {
  const Flow = pickFlow(ctx?.text || '', ctx?.settings || {}, ctx?.state || {});
  return Flow(ctx);
}

// Exporta também o roteador e a ordem referencial
export { router, pickFlow, ordered };

export default {
  registry,
  handle,
  router,
  pickFlow,
  ordered,
};
