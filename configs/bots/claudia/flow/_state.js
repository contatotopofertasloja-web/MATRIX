// configs/bots/claudia/flow/_state.js
// Utilitários de estado (memória diária em Redis) + helpers de formatação e carimbo.

import Redis from "ioredis";

const REDIS_URL = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || "redis://localhost:6379";
const redis = new Redis(REDIS_URL);
const TTL = 60 * 60 * 24; // 1 dia

const key = (jid) => `state:${jid}`;

export async function remember(jid, patch = {}) {
  try {
    const data = {};
    for (const [k, v] of Object.entries(patch)) data[k] = JSON.stringify(v);
    if (Object.keys(data).length) {
      await redis.hset(key(jid), data);
      await redis.expire(key(jid), TTL);
    }
  } catch {}
}

export async function recall(jid) {
  try {
    const raw = await redis.hgetall(key(jid));
    const out = {};
    for (const [k, v] of Object.entries(raw)) out[k] = JSON.parse(v);
    return out;
  } catch {
    return {};
  }
}

export function callUser(state) {
  return state?.profile?.name || "";
}

export function ensureProfile(state) {
  state.profile = state.profile || {};
  return state.profile;
}

export function tagReply(_settings, text, tag = "flow") {
  const t = String(text || "").trim();
  return t ? `${t} (${tag})` : "";
}

export function normalizeSettings(s = {}) {
  const p = s.product || {};
  const g = s.guardrails || {};
  const m = s.marketing || {};
  return {
    product: {
      name: p.name || "Progressiva Vegetal",
      store_name: p.store_name || "TopOfertas",
      price_original: p.price_original ?? 197,
      price_target: p.price_target ?? 170,
      checkout_link: p.checkout_link || "",
      site_url: p.site_url || "",
      coupon_code: p.coupon_code || "",
      opening_hours: p.opening_hours || "Seg a Sex, 9h às 18h",
      delivery_sla: {
        capitals_hours: p?.delivery_sla?.capitals_hours ?? 24,
        others_hours: p?.delivery_sla?.others_hours ?? 72,
      },
    },
    guardrails: {
      allow_links_only_from_list: !!g.allow_links_only_from_list,
      allowed_links: Array.isArray(g.allowed_links) ? g.allowed_links : [],
    },
    marketing: {
      sold_count: m.sold_count ?? 40000,
    },
    flags: s.flags || {},
    messages: s.messages || {},
    media: s.media || {},
  };
}
