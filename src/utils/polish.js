// src/utils/polish.js — sanitizadores de copy com whitelist de links
const RX_MONEY = /\bR\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?\b/gi;
const RX_PRICE_WORDS = /\b(preço|preco|valor|custa|custar|custando|valendo|quanto\s*custa)\b/gi;
const RX_URL = /\bhttps?:\/\/[^\s)]+/gi;

/**
 * isAllowed: verifica se a URL está whitelisted.
 * allowedLinks pode ser um array de strings (match exato ou prefixo).
 */
function isAllowed(url = "", allowedLinks = []) {
  try {
    const list = Array.isArray(allowedLinks) ? allowedLinks : [];
    const u = String(url || "").trim();
    if (!u) return false;
    return list.some((tpl) => {
      const s = String(tpl || "").trim();
      if (!s) return false;
      return u === s || u.startsWith(s.replace(/\*+$/,""));
    });
  } catch { return false; }
}

/**
 * sanitizeOutbound
 * - allowLink: se true, links são preservados;
 * - allowedLinks: lista de whitelists (se allowLink=false, preserva só whitelisted);
 * - allowPrice: se false, mascara valores/termos.
 */
export function sanitizeOutbound(text, { allowPrice = false, allowLink = false, allowedLinks = [] } = {}) {
  let out = String(text || "");

  // LINKS
  if (!allowLink) {
    out = out.replace(RX_URL, (m) => (isAllowed(m, allowedLinks) ? m : "[link removido]"));
  }

  // PREÇOS
  if (!allowPrice) {
    out = out.replace(RX_MONEY, "[preço disponível sob pedido]");
    out = out.replace(RX_PRICE_WORDS, "o valor");
    out = out.replace(/\b(custa|custar|custando)\s*\[preço disponível sob pedido\]/gi, "tem um valor que posso te informar quando quiser");
    out = out.replace(/\s*\[preço disponível sob pedido\]\s*\[preço disponível sob pedido\]/gi, " [preço disponível sob pedido]");
  }

  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * finalizeOutbound: helper para adapter/outbox
 * Recebe text + meta ({allowLink, allowPrice, allowedLinks}) e aplica sanitize.
 */
export function finalizeOutbound(text, meta = {}) {
  const { allowLink = false, allowPrice = false, allowedLinks = [] } = meta || {};
  return sanitizeOutbound(text, { allowLink, allowPrice, allowedLinks });
}
