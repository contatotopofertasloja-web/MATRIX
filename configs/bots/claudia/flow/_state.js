// configs/bots/claudia/flow/_state.js
// Utilitários de estado (memória leve do FLOW com TTL em Redis) + helpers de formatação, gates e defaults.
// Observação: isso é complementar ao core/session.js. Se Redis cair, o flow segue com fallback in-memory.

import Redis from "ioredis";

// ==== ENV / Defaults ====
const REDIS_URL = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || "";
const BOT_ID = process.env.BOT_ID || "claudia";
const TTL = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24); // default 1 dia

// Redis (com hardening) + fallback em memória
let redis = null;
try {
  if (REDIS_URL) {
    redis = new Redis(REDIS_URL);
    redis.on("error", (e) => {
      console.warn("[flow/_state] redis error:", e?.message || e);
    });
  }
} catch {
  redis = null;
}
const mem = new Map();
const key = (jid) => `mx:flow:v1:${BOT_ID}:${jid}`;

// ==== API de memória do FLOW ====
export async function remember(jid, patch = {}) {
  try {
    const data = {};
    for (const [k, v] of Object.entries(patch)) data[k] = JSON.stringify(v);
    if (!Object.keys(data).length) return;

    if (redis) {
      await redis.hset(key(jid), data);
      await redis.expire(key(jid), TTL); // sliding TTL
    } else {
      const prev = mem.get(key(jid)) || {};
      mem.set(key(jid), { ...prev, ...data, __ts: Date.now() });
    }
  } catch (e) {
    console.warn("[flow/_state] remember fail:", e?.message || e);
  }
}

export async function recall(jid) {
  try {
    if (redis) {
      const raw = await redis.hgetall(key(jid));
      const out = {};
      for (const [k, v] of Object.entries(raw || {})) {
        try { out[k] = JSON.parse(v); } catch { out[k] = null; }
      }
      // renovamos o TTL a cada leitura
      try { await redis.expire(key(jid), TTL); } catch {}
      return out;
    }
    const raw = mem.get(key(jid)) || {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === "__ts") continue;
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    }
    return out;
  } catch (e) {
    console.warn("[flow/_state] recall fail:", e?.message || e);
    return {};
  }
}

// ==== Helpers de estado local (em ctx.state) ====
export function initialState() {
  return {
    // perfil coletado no qualify
    profile: { name: null, hair_type: null, goal: null, had_prog_before: null },
    // marcadores anti-loop
    __asked_hair_type_at: 0,
    __asked_had_prog_before_at: 0,
    __asked_goal_at: 0,
    __last_q_key: null,
    __last_q_at: 0,
    __any_out_at: 0,
    __boot_greet_done: false,
    __sent_opening_photo: false,
    __qualify_hits: 0,
    // estágio corrente do funil
    stage: null,
    // telemetria leve
    turns: 0,
  };
}

export function gate(state, tag, ms) {
  const k = `__gate_${tag}_at`;
  const now = Date.now();
  const last = state[k] || 0;
  if (now - last < ms) return true;
  state[k] = now;
  return false;
}

export function setStage(state, newStage) {
  state.stage = String(newStage || "").trim() || null;
  return state.stage;
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

// Normaliza settings para evitar “undefined” nos flows
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
