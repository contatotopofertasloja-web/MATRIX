// src/utils/polish.js
// Sanitizadores de copy para vendas

const RX_MONEY = /\bR\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?\b/gi;
const RX_PRICE_WORDS = /\b(preço|preco|valor|custa|custar|custando|valendo|quanto\s*custa)\b/gi;

export function sanitizeOutbound(text, { allowPrice = false, allowLink = false } = {}) {
  let out = String(text || "");

  // link: se não permitido, remove qualquer URL e troca por placeholder
  if (!allowLink) {
    out = out.replace(/\bhttps?:\/\/[^\s]+/gi, "(posso te mandar o link quando você quiser)");
  }

  // preço: se não permitido, remove valores E menções
  if (!allowPrice) {
    out = out.replace(RX_MONEY, "[preço disponível sob pedido]");
    // Se ficou "custa [preço disponível sob pedido]" ou "preço [..]" → suaviza a frase
    out = out.replace(RX_PRICE_WORDS, "o valor");
    // Frases agressivas tipo "custa [preço ...]" → reduzir
    out = out.replace(/\b(custa|custar|custando)\s*\[preço disponível sob pedido\]/gi, "tem um valor que posso te informar quando quiser");
    // Evitar repetição de placeholder
    out = out.replace(/\s*\[preço disponível sob pedido\]\s*\[preço disponível sob pedido\]/gi, " [preço disponível sob pedido]");
  }

  // limpeza leve de espaços
  out = out.replace(/\s{2,}/g, " ").trim();
  return out;
}
