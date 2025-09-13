// configs/bots/claudia/flow/_state.js — memória e helpers por contato (expandido)

// Consentimento para enviar link
const consent = new Map();        // jid -> boolean
// Cooldown para não repetir preço/oferta toda hora
const offerCooldown = new Map();  // jid -> timestamp

// Perfil simples por contato
const profile = new Map();        // jid -> { name, hairType, goal }
// Throttle de perguntas (evita perguntar a mesma coisa toda hora)
const asked = new Map();          // jid -> Map<key, timestamp>

// Sinalizadores de sessão (ex.: teaser de sorteio já mostrado)
const sessionFlags = new Map();   // jid -> { teaserShown?: boolean }

export function setAwaitingConsent(jid, val = true) { if (jid) consent.set(jid, !!val); }
export function isAwaitingConsent(jid) { return !!consent.get(jid); }
export function clearConsent(jid) { consent.delete(jid); }

export function canOfferNow(jid, ms = 90_000) {
  const t = offerCooldown.get(jid) || 0;
  const ok = Date.now() - t > ms;
  if (ok) offerCooldown.set(jid, Date.now());
  return ok;
}

// ---- Perfil / Perguntas
function _slot(map, jid) {
  const cur = map.get(jid);
  if (cur) return cur;
  const fresh = map === asked ? new Map() : {};
  map.set(jid, fresh);
  return fresh;
}

export function setUserProfile(jid, patch = {}) {
  const cur = _slot(profile, jid);
  profile.set(jid, { ...cur, ...patch });
}
export function getUserProfile(jid) { return profile.get(jid) || {}; }

export function shouldAsk(jid, key, cooldownMs = 90_000) {
  const meter = _slot(asked, jid);
  const last = meter.get(key) || 0;
  const ok = Date.now() - last > cooldownMs;
  if (ok) meter.set(key, Date.now());
  return ok;
}

// ---- Sorteio (mostrar teaser só 1x por sessão)
export function shouldShowTeaser(jid) {
  const flags = _slot(sessionFlags, jid);
  return !flags.teaserShown;
}
export function markTeaserShown(jid) {
  const flags = _slot(sessionFlags, jid);
  flags.teaserShown = true;
}

// ---- Negócio / horário
export function isWithinBusinessHours(settings, date = new Date()) {
  const tz = Number(settings?.business?.tz_offset_hours ?? -3);
  const start = settings?.business?.hours_start ?? '06:00';
  const end   = settings?.business?.hours_end   ?? '21:00';
  const local = new Date(date.getTime() + tz * 3600 * 1000);
  const h = local.getHours(), m = local.getMinutes();
  const [sh, sm] = String(start).split(':').map(n => +n || 0);
  const [eh, em] = String(end).split(':').map(n => +n || 0);
  const nowM = h * 60 + m, startM = sh * 60 + sm, endM = eh * 60 + em;
  return nowM >= startM && nowM < endM;
}

// ---- Checkout/Preço com fallbacks
export function getCheckoutLink(settings) {
  // 1) settings da bot
  if (settings?.product?.checkout_link) return settings.product.checkout_link;
  // 2) ENV (Railway)
  if (process.env.CHECKOUT_LINK) return process.env.CHECKOUT_LINK;
  // 3) Fallback seguro (o link oficial informado)
  return 'https://entrega.logzz.com.br/pay/memmpxgmg/progcreme170';
}

export function getTargetPrice(settings) {
  const envPrice = Number(process.env.PRICE_TARGET);
  if (Number.isFinite(envPrice)) return envPrice;
  const sPrice = Number(settings?.product?.price_target);
  if (Number.isFinite(sPrice)) return sPrice;
  return 170;
}
