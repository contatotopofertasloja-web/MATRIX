// configs/bots/maria/flow/index.js
// Router mínimo: greet → offer → close, priorizando fechamento quando detectar CEP/endereço.

import greet from './greet.js';
import offer, { match as matchOffer } from './offer.js';
import close, { match as matchClose } from './close.js';

function norm(s = '') {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function pickFlow(text = '', settings = {}) {
  // 1) Se parecer endereço/CEP → close
  if (matchClose(text)) return close;

  // 2) Sinais de oferta/interesse → offer
  if (matchOffer(text)) return offer;

  // 3) Default → greet
  return greet;
}

export default {
  greet,
  offer,
  close,
  pickFlow,
};
