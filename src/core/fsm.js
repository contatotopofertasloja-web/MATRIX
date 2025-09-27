// src/core/fsm.js — FSM neutra (sem domínios). Slots genéricos e anti-loop.
import crypto from "node:crypto";

const DEFAULT_STAGE = process.env.FSM_DEFAULT_STAGE || "greet";
const NS            = process.env.FSM_NAMESPACE || "matrix:fsm";
const TTL_SEC       = Number(process.env.SESSION_TTL_SECONDS || 86400);
const TTL_MS        = TTL_SEC * 1000;
const HISTORY_MAX   = Number(process.env.FSM_HISTORY_MAX || 20);
const ASK_COOLDOWN  = Number(process.env.FSM_ASK_COOLDOWN_MS || 90_000);

export const STAGES = ["greet", "qualify", "offer", "close", "postsale"];
const NEXT_OF = { greet: "qualify", qualify: "offer", offer: "close", close: "postsale", postsale: "postsale" };

let redis = null;

// Redis opcional
async function ensureRedis() {
  if (redis !== null) return redis;
  try {
    const mod = await import("./redis.js").catch(() => null);
    if (mod?.getRedis) {
      const r = await mod.getRedis();
      if (r) { redis = r; return redis; }
    }
  } catch {}
  redis = undefined; return redis;
}

const mem = {
  map: new Map(), now: () => Date.now(),
  get(k) { const it = this.map.get(k); if (!it) return null; if (it.expireAt < this.now()) { this.map.delete(k); return null; } return it.data; },
  set(k, v) { this.map.set(k, { data: v, expireAt: this.now() + TTL_MS }); },
  del(k) { this.map.delete(k); },
};

const key = (botId, userId) => `${NS}:${botId}:${userId}`;
const safeJson = (s, d = null) => { try { return JSON.parse(String(s || "")); } catch { return d; } };

function newSession({ botId, userId, extra }) {
  return {
    id: crypto.randomUUID(),
    botId, userId,
    stage: DEFAULT_STAGE,
    slots: {
      name: null,
      objective: null,
      phone: null,
      address_line: null,
      zipcode: null,
      city: null,
    },
    flags: { opening_media_sent: false },
    context: { history: [], asked: {}, events: {} },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  };
}

export async function getSession({ botId, userId, createIfMissing = true, extra = {} }) {
  const k = key(botId, userId);
  const r = await ensureRedis();
  if (r) {
    const raw = await r.get(k);
    if (!raw) {
      if (!createIfMissing) return null;
      const s = newSession({ botId, userId, extra });
      await r.set(k, JSON.stringify(s), { EX: TTL_SEC });
      return s;
    }
    const s = safeJson(raw, null) || newSession({ botId, userId, extra });
    s.updatedAt = Date.now();
    await r.set(k, JSON.stringify(s), { EX: TTL_SEC });
    return s;
  }
  const local = mem.get(k);
  if (!local && !createIfMissing) return null;
  const s = local || newSession({ botId, userId, extra });
  mem.set(k, s);
  return s;
}

export async function saveSession(session) {
  if (!session?.botId || !session?.userId) return;
  session.updatedAt = Date.now();
  const k = key(session.botId, session.userId);
  const r = await ensureRedis();
  if (r) await r.set(k, JSON.stringify(session), { EX: TTL_SEC });
  else mem.set(k, session);
}

// histórico + anti-loop
export function pushHistory(session, role, content) {
  if (!session?.context?.history) return;
  session.context.history.push({ ts: Date.now(), role, content });
  while (session.context.history.length > HISTORY_MAX) session.context.history.shift();
}
export function canAsk(session, askId) {
  const last = session?.context?.asked?.[askId] || 0;
  return Date.now() - last > ASK_COOLDOWN;
}
export function markAsked(session, askId) {
  if (!session?.context?.asked) session.context.asked = {};
  session.context.asked[askId] = Date.now();
}

// slots genéricos
export function setSlot(session, key, value) {
  if (!session?.slots) session.slots = {};
  session.slots[key] = value;
}
export function getSlot(session, key, fallback = null) {
  return session?.slots?.[key] ?? fallback;
}

// estágios
export function normalizeStage(s = "") { const x = String(s || "").toLowerCase(); return STAGES.includes(x) ? x : "greet"; }
export function setStage(session, stage) { session.stage = normalizeStage(stage); }
export function advanceStage(session) { const cur = normalizeStage(session.stage); session.stage = NEXT_OF[cur] || "qualify"; return session.stage; }
export function forceStage(session, stage) { session.stage = normalizeStage(stage); return session.stage; }

// stickiness no fechamento
export function shouldStickToClose(session, userText = "") {
  const t = String(userText || "");
  const cancel = /\b(cancelar|voltar|mudar|n[aã]o quero|parar)\b/i.test(t);
  return session.stage === "close" && !cancel;
}
