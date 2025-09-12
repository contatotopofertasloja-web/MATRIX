// _state.js — memória simples por contato
const consent = new Map();   // jid -> true quando perguntou "posso enviar o link?"
const offerCooldown = new Map(); // jid -> timestamp última oferta/preço

export function setAwaitingConsent(jid, val = true) { if (jid) consent.set(jid, !!val); }
export function isAwaitingConsent(jid) { return !!consent.get(jid); }
export function clearConsent(jid) { consent.delete(jid); }

export function canOfferNow(jid, ms = 90_000) {
  const t = offerCooldown.get(jid) || 0;
  const ok = Date.now() - t > ms;
  if (ok) offerCooldown.set(jid, Date.now());
  return ok;
}
