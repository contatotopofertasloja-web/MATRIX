// src/core/fsm.js
// FSM leve e NEUTRA — estado por usuário (stage, slots, context, histórico), Redis opcional.

import crypto from "node:crypto";

const DEFAULT_STAGE = process.env.FSM_DEFAULT_STAGE || "recepcao";
const NS            = process.env.FSM_NAMESPACE || "matrix:fsm";
const TTL_SEC       = Number(process.env.SESSION_TTL_SECONDS || 86400);  // 24h
const TTL_MS        = TTL_SEC * 1000;
const HISTORY_MAX   = Number(process.env.FSM_HISTORY_MAX || 10);
const ASK_COOLDOWN  = Number(process.env.FSM_ASK_COOLDOWN_MS || 90_000); // 90s

let redis = null, redisImpl = "none";

async function ensureRedis() {
  if (redis !== null) return redis;
  try {
    const mod = await import("./redis.js").catch(() => null);
    if (mod?.getRedis) {
      const r = await mod.getRedis();
      if (r) { redis = r; redisImpl = "module"; return redis; }
    }
  } catch {}

  const url = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || "";
  if (!url) { redis = undefined; redisImpl = "none"; return redis; }

  try {
    const io = await import("ioredis");
    const client = new io.default(url, { lazyConnect: false, enableReadyCheck: true, maxRetriesPerRequest: null });
    client.on("error", (e) => console.error("[FSM][ioredis] error", e?.message || e));
    // ioredis já conecta no ctor; interface simplificada:
    redis = {
      get: (k) => client.get(k),
      set: (k, v, opts) => client.set(k, v, "EX", (opts?.EX ?? TTL_SEC)),
      del: (k) => client.del(k),
      ttl: (k) => client.ttl(k),
    };
    redisImpl = "ioredis";
    return redis;
  } catch {}

  try {
    const { createClient } = await import("redis");
    const client = createClient({ url });
    client.on("error", (e) => console.error("[FSM][redis] error", e?.message || e));
    await client.connect();
    redis = {
      get: (k) => client.get(k),
      set: (k, v, opts) => client.set(k, v, { EX: (opts?.EX ?? TTL_SEC) }),
      del: (k) => client.del(k),
      ttl: (k) => client.ttl(k),
    };
    redisImpl = "redis";
    return redis;
  } catch {}

  redis = undefined; redisImpl = "none"; return redis;
}

const mem = {
  map: new Map(), now: () => Date.now(),
  get(k) { const it = this.map.get(k); if (!it) return null; if (it.expireAt < this.now()) { this.map.delete(k); return null; } return it.data; },
  set(k, v) { this.map.set(k, { data: v, expireAt: this.now() + TTL_MS }); },
  del(k) { this.map.delete(k); },
  touch(k) { const it = this.map.get(k); if (it) it.expireAt = this.now() + TTL_MS; }
};

const key = (botId, userId) => `${NS}:${botId}:${userId}`;
const safeJson = (s, d = null) => { try { return JSON.parse(String(s || "")); } catch { return d; } };

function newSession({ botId, userId, extra }) {
  return {
    id: crypto.randomUUID(),
    botId, userId,
    stage: DEFAULT_STAGE,
    slots: {},
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
    await r.set(k, JSON.stringify(s), { EX: TTL_SEC }); // touch
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
  const k = key(session.botId, session.userId);
  session.updatedAt = Date.now();
  const r = await ensureRedis();
  if (r) await r.set(k, JSON.stringify(session), { EX: TTL_SEC });
  else mem.set(k, session);
}

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
