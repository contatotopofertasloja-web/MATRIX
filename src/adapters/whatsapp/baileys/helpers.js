// src/adapters/whatsapp/baileys/helpers.js
// Utilidades compartilhadas pelo sender/receiver (Baileys).

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function normalizeJid(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) throw new Error("destinatário inválido");
  return digits.endsWith("@s.whatsapp.net") ? digits : `${digits}@s.whatsapp.net`;
}

// Debounce/dedupe simples por (jid, text) em N ms
const seen = new Map(); // key=>ts
export function isDuplicate({ jid, text, windowMs = 3500 }) {
  const key = `${jid}::${String(text || "").trim()}`.slice(0, 512);
  const now = Date.now();
  const ts = seen.get(key) || 0;
  if (now - ts < windowMs) return true;
  seen.set(key, now);
  return false;
}

// Proteção extra para números/links em texto (o adapter principal já sanitiza)
const RX_PRICE = /\bR\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?\b/g;
const RX_LINK  = /\bhttps?:\/\/\S+/gi;
export function stripPriceUnlessAllowed(text, allow = false) {
  return allow ? text : String(text || "").replace(RX_PRICE, "[preço sob pedido]");
}
export function stripLinksUnlessAllowed(text, allow = false) {
  return allow ? text : String(text || "").replace(RX_LINK, "[link removido]");
}
