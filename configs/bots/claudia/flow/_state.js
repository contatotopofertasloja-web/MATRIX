// configs/bots/claudia/flow/_state.js
// Utilitários de estado (profile, asked, tagging) + normalizeSettings (NOVO)

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

export function tagReply(_ctx, text, tag) {
  return `[${tag}] ${text}`;
}

export function filledSummary(state) {
  const p = state.profile || {};
  const items = [];
  if (p.goal) items.push(`objetivo: ${p.goal}`);
  if (p.phone) items.push(`telefone: ${p.phone}`);
  return items;
}

/* ======================= normalizeSettings (NOVO) =======================

Garante que o objeto "settings" chegue com shape e defaults mínimos para o fluxo.
Não tem “cheiro de Cláudia”: apenas organiza campos comuns usados no offer.js.

Campos considerados (lidos pelo fluxo):
- product.price_original / price_target / price_promo_day / promo_day_quota
- product.delivery_sla.capitals_hours / others_hours
- product.checkout_link
- payments.installments_max
- marketing.sold_count
- fallback.prepaid_price / prepaid_partner / prepaid_link
- integrations.logzz.webhook_url / token

*/
export function normalizeSettings(incoming = {}) {
  // clones rasos p/ não mutar referência original
  const S = { ...(incoming || {}) };

  // nós-base
  S.product      = { ...(S.product || {}) };
  S.product.delivery_sla = { ...(S.product.delivery_sla || {}) };
  S.payments     = { ...(S.payments || {}) };
  S.marketing    = { ...(S.marketing || {}) };
  S.fallback     = { ...(S.fallback || {}) };
  S.integrations = { ...(S.integrations || {}) };
  S.integrations.logzz = { ...(S.integrations.logzz || {}) };

  // utilitários simples de coalescência
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const str = (v, d="") => (v == null ? d : String(v));

  // defaults de produto
  S.product.price_original   = num(S.product.price_original, 197);
  S.product.price_target     = num(S.product.price_target,   170);
  S.product.price_promo_day  = num(S.product.price_promo_day,150);
  S.product.promo_day_quota  = num(S.product.promo_day_quota,5);
  S.product.checkout_link    = str(S.product.checkout_link, "");

  // SLA de entrega
  S.product.delivery_sla.capitals_hours = num(S.product.delivery_sla.capitals_hours, 24);
  S.product.delivery_sla.others_hours   = num(S.product.delivery_sla.others_hours,   72);

  // pagamentos / marketing
  S.payments.installments_max = num(S.payments.installments_max, 12);
  S.marketing.sold_count      = num(S.marketing.sold_count,      40000);

  // fallback (pré-pago/Correios)
  const prepaidPriceFallback = S.product.price_target ?? 170;
  S.fallback.prepaid_price   = num(S.fallback.prepaid_price, prepaidPriceFallback);
  S.fallback.prepaid_partner = str(S.fallback.prepaid_partner, "Coinzz");
  S.fallback.prepaid_link    = str(S.fallback.prepaid_link, S.product.checkout_link || "");

  // integrações (Logzz)
  S.integrations.logzz.webhook_url = str(S.integrations.logzz.webhook_url, "");
  S.integrations.logzz.token       = str(S.integrations.logzz.token, "");

  return S;
}
