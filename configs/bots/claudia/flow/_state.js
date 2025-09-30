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
 * Agora retorna objeto { reply, meta } em vez de string simples.
 */
export function tagReply(_ctx, text, tag) {
  return {
    reply: `${text}`,            // texto da bolha
    meta: { tag }                // carimbo usado no orchestrator/polish
  };
}

export function filledSummary(state) {
  const p = state.profile || {};
  const items = [];
  if (p.goal) items.push(`objetivo: ${p.goal}`);
  if (p.phone) items.push(`telefone: ${p.phone}`);
  return items;
}

/* ======================= normalizeSettings =======================
Garante defaults e shape mínimo de settings; neutro (sem “cheiro” de bot).
*/
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

  S.product.price_original   = num(S.product.price_original, 197);
  S.product.price_target     = num(S.product.price_target,   170);
  S.product.price_promo_day  = num(S.product.price_promo_day,150);
  S.product.promo_day_quota  = num(S.product.promo_day_quota,5);
  S.product.checkout_link    = str(S.product.checkout_link, "");

  S.product.delivery_sla.capitals_hours = num(S.product.delivery_sla.capitals_hours, 24);
  S.product.delivery_sla.others_hours   = num(S.product.delivery_sla.others_hours,   72);

  S.payments.installments_max = num(S.payments.installments_max, 12);
  S.marketing.sold_count      = num(S.marketing.sold_count,      40000);

  const prepaidPriceFallback = S.product.price_target ?? 170;
  S.fallback.prepaid_price   = num(S.fallback.prepaid_price, prepaidPriceFallback);
  S.fallback.prepaid_partner = str(S.fallback.prepaid_partner, "Coinzz");
  S.fallback.prepaid_link    = str(S.fallback.prepaid_link, S.product.checkout_link || "");

  S.integrations.logzz.webhook_url = str(S.integrations.logzz.webhook_url, "");
  S.integrations.logzz.token       = str(S.integrations.logzz.token, "");

  return S;
}
