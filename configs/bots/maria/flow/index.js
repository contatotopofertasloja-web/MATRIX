// configs/bots/maria/flow/index.js
// Router mínimo da Maria: greet → offer → close, com fallback simples.
// Prioriza fechamento quando detectar CEP/endereço.

import greet from './greet.js';
import offer, { match as matchOffer } from './offer.js';
import close, { match as matchClose } from './close.js';
import { getState, setState } from './_state.js';

function norm(s = '') {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function pickFlow(text = '', settings = {}) {
  const t = norm(text);

  // 1) Se mensagem parece endereço/CEP → close
  if (matchClose(text)) return close;

  // 2) Sinais de oferta/interesse → offer
  if (matchOffer(text)) return offer;

  // 3) Fallback para greet (coleta nome/tipo e dispara oferta curta)
  return greet;
}

// Compat com loader: exportar objeto de handlers
export default {
  greet,
  offer,
  close,
  pickFlow,
};
