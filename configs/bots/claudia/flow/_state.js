// configs/bots/claudia/flow/_state.js
// Helpers de estado compartilhados entre os flows da Cláudia.

const DEFAULTS = {
  product: {
    name: "",
    store_name: "",
    price_original: 0,
    price_target: 0,
    checkout_link: "",
    delivery_sla: { capitals_hours: 48, others_hours: 96 },
    coupon_post_payment_only: false,
    coupon_code: "",
  },
  marketing: { sold_count: 0 },
  messages: {},
  flags: {},
};

export function normalizeSettings(settings = {}) {
  return {
    ...DEFAULTS,
    ...settings,
    product:   { ...DEFAULTS.product,   ...(settings.product   || {}) },
    marketing: { ...DEFAULTS.marketing, ...(settings.marketing || {}) },
    messages:  { ...DEFAULTS.messages,  ...(settings.messages  || {}) },
    flags:     { ...DEFAULTS.flags,     ...(settings.flags     || {}) },
  };
}

export function initialState() {
  return {
    turns: 0,
    profile: {
      name: "",
      hair_type: "",           // liso | ondulado | cacheado | crespo
      goal: "",                // brilho / alinhar / reduzir frizz...
      had_prog_before: null,   // true / false
    },
    asked: {},
    ratified: false,
    __sent_opening_photo: false,
    stage: "",
  };
}

export function ensureProfile(state = {}) {
  if (!state.profile) state.profile = initialState().profile;
  return state.profile;
}
export function ensureAsked(state = {}) {
  if (!state.asked) state.asked = {};
  return state.asked;
}
export function markAsked(state = {}, key, at = Date.now()) {
  ensureAsked(state);
  state.asked[key] = { at };
  return state.asked[key];
}
export function isFilled(state = {}, key) {
  const p = (state && state.profile) || {};
  if (!(key in p)) return false;
  const v = p[key];
  if (typeof v === "boolean") return v === true || v === false;
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}
export function callUser(state = {}) {
  const n = state?.profile?.name || "";
  if (!n) return "";
  return String(n).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
export function filledSummary(state = {}) {
  const p = state?.profile || {};
  const parts = [];
  if (p.hair_type) parts.push(`cabelo ${p.hair_type}`);
  if (p.goal) parts.push(`objetivo: ${p.goal}`);
  if (p.had_prog_before != null)
    parts.push(p.had_prog_before ? "já fez progressiva" : "primeira vez");
  return parts;
}
export function tagReply(_S, text, tag = "", extraMeta = {}) {
  const allowLink  = /\bhttps?:\/\//i.test(String(text));
  const allowPrice = /R\$\s?\d/.test(String(text));
  return {
    reply: String(text || ""),
    next: undefined,
    meta: { tag, allowLink, allowPrice, ...extraMeta },
  };
}
export function gate(state = {}, key, ms = 1000) {
  const now = Date.now();
  const k = `__gate_${key}`;
  const last = state[k] || 0;
  if (now - last < ms) return true;
  state[k] = now;
  return false;
}
