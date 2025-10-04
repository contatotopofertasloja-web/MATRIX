// configs/bots/claudia/flow/price-utils.js
// Centraliza leitura das ENV/Settings e formata os preços
// de forma "à prova de sanitizer" (caractere invisível entre dígitos).

import { normalizeSettings } from "./_state.js";

// caractere invisível (Zero Width Non-Joiner): não aparece no WhatsApp,
// mas quebra os \d+ do regex de mascaramento.
const ZW = "\u200C";

// insere o ZW entre dígitos (ex.: "197" -> "1\u200C97")
function obfuscateDigits(n) {
  return String(n).replace(/(\d)(?=\d)/g, `$1${ZW}`);
}

export function fmtPrice(n) {
  // retorna "R$ 197" (com invisível entre os dígitos)
  return `R$ ${obfuscateDigits(n)}`;
}

export function getPrices(settings) {
  const S = normalizeSettings(settings);
  const env = (typeof process !== "undefined" ? process.env : {}) || {};

  const original  = Number(env.CLAUDIA_PRICE_ORIGINAL   ?? S?.product?.price_original ?? 197);
  const target    = Number(env.CLAUDIA_PRICE_TARGET     ?? S?.product?.price_target   ?? 170);
  const promoDay  = Number(env.CLAUDIA_PRICE_PROMO_DAY  ?? S?.product?.price_promo_day ?? target);
  const prepaid   = Number(env.CLAUDIA_PREPAID_PRICE    ?? S?.fallback?.prepaid_price  ?? target);

  return { original, target, promoDay, prepaid };
}
