// configs/bots/claudia/flow/_state.js
// Utilitários de estado (profile, asked, tagging) + normalizeSettings

export function ensureProfile(state) {
  state.profile = state.profile || {};
  return state.profile;
}

export function ensureAsked(state) {
  state.asked = state.asked || {};
  return state.asked;
}

export function markAsked(state, key) {
  const a = ensureAsked(state);
  a[key] = true;
}

export function isFilled(state, key) {
  return !!(state.profile && state.profile[key]);
}

export function callUser(state) {
  const p = state.profile || {};
  return p.name ? p.name.split(" ")[0] : "";
}

/**
 * Cria um reply estruturado para o orchestrator.
 * Importante: devolve { reply, meta }.
 */
export function tagReply(_ctx, text, tag) {
  return {
    reply: `${text}`,
    meta: { tag }
  };
}

export function filledSummary(state) {
  const p = state.profile || {};
  const items = [];
  if (p.goal) items.push(`objetivo: ${p.goal}`);
  if (p.phone) items.push(`telefone: ${p.phone}`);
  return items;
}

// ---------- Helpers de ENV para travar preços ---------- //
const envNum = (key, fallback) => {
  const raw = process?.env?.[key];
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};
const envStr = (key, fallback = "") => {
  const v = process?.env?.[key];
  return (v == null ? fallback : String(v));
};

export function normalizeSettings(incoming = {}) {
  const S = { ...(incoming || {}) };
  S.product      = { ...(S.product || {}) };
  S.product.delivery_sla = { ...(S.product.delivery_sla || {}) };
  S.payments     = { ...(S.payments || {}) };
  S.marketing    = { ...(S.marketing || {}) };
  S.fallback     = { ...(S.fallback || {}) };
  S.integrations = { ...(S.integrations || {}) };
  S.integrations.logzz = { ...(S.integrations.logzz || {}) };

  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const str = (v, d="") => (v == null ? d : String(v));

  // --- Preços base do settings (com default) ---
  let priceOriginal  = num(S.product.price_original, 197);
  let priceTarget    = num(S.product.price_target,   170);
  let pricePromoDay  = num(S.product.price_promo_day,150);

  // --- OVERRIDE por ENV (Railway) — se existir, substitui ---
  priceOriginal = envNum('CLAUDIA_PRICE_ORIGINAL', priceOriginal);
  priceTarget   = envNum('CLAUDIA_PRICE_TARGET',   priceTarget);
  pricePromoDay = envNum('CLAUDIA_PRICE_PROMO_DAY',pricePromoDay);

  S.product.price_original   = priceOriginal;
  S.product.price_target     = priceTarget;
  S.product.price_promo_day  = pricePromoDay;
  S.product.promo_day_quota  = num(S.product.promo_day_quota,5);
  S.product.checkout_link    = str(S.product.checkout_link, "");

  S.product.delivery_sla.capitals_hours = num(S.product.delivery_sla.capitals_hours, 24);
  S.product.delivery_sla.others_hours   = num(S.product.delivery_sla.others_hours,   72);

  S.payments.installments_max = num(S.payments.installments_max, 12);
  S.marketing.sold_count      = num(S.marketing.sold_count,      40000);

  // Prepaid (fora de cobertura) — pode travar via ENV também
  const prepaidFallback = priceTarget; // default = target
  let prepaidPrice = num(S.fallback.prepaid_price, prepaidFallback);
  prepaidPrice = envNum('CLAUDIA_PREPAID_PRICE', prepaidPrice);

  S.fallback.prepaid_price   = prepaidPrice;
  S.fallback.prepaid_partner = str(S.fallback.prepaid_partner, "Coinzz");
  S.fallback.prepaid_link    = str(S.fallback.prepaid_link, S.product.checkout_link || "");

  S.integrations.logzz.webhook_url = str(S.integrations.logzz.webhook_url, "");
  S.integrations.logzz.token       = str(S.integrations.logzz.token, "");

  return S;
}
