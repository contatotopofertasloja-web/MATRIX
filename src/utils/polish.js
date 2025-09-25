// src/utils/polish.js — sanitizadores de copy
const RX_MONEY = /\bR\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?\b/gi;
const RX_PRICE_WORDS = /\b(preço|preco|valor|custa|custar|custando|valendo|quanto\s*custa)\b/gi;

export function sanitizeOutbound(text, { allowPrice = false, allowLink = false } = {}) {
  let out = String(text || "");

  // link
  if (!allowLink) {
    out = out.replace(/\bhttps?:\/\/[^\s]+/gi, "[link removido]");
  }

  // preço
  if (!allowPrice) {
    out = out.replace(RX_MONEY, "[preço disponível sob pedido]");
    out = out.replace(RX_PRICE_WORDS, "o valor");
    out = out.replace(/\b(custa|custar|custando)\s*\[preço disponível sob pedido\]/gi, "tem um valor que posso te informar quando quiser");
    out = out.replace(/\s*\[preço disponível sob pedido\]\s*\[preço disponível sob pedido\]/gi, " [preço disponível sob pedido]");
  }

  return out.replace(/\s{2,}/g, " ").trim();
}
