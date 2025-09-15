// src/core/fsm.js
// FSM leve: guarda estado de cada user em Redis (ou memória).
// Neutro → controlado pelo LLM/orquestrador.

import crypto from "node:crypto";

let redis = null;
async function getRedis() {
  if (redis !== null) return redis;
  try {
    const mod = await import("./redis.js").catch(() => null);
    if (mod?.getRedis) {
      redis = await mod.getRedis();
    } else if (process.env.MATRIX_REDIS_URL) {
      const { createClient } = await import("redis");
      const client = createClient({ url: process.env.MATRIX_REDIS_URL });
      client.on("error", (e) => console.error("[FSM][redis] error", e));
      await client.connect();
      redis = client;
    } else {
      redis = undefined;
    }
  } catch {
    redis = undefined;
  }
  return redis;
}

// fallback memória
const mem = {
  map: new Map(),
  ttlMs: Number(process.env.SESSION_TTL_HOURS || 24) * 60 * 60 * 1000,
  now: () => Date.now(),
  get(k) {
    const i = this.map.get(k);
    if (!i) return null;
    if (i.expireAt < this.now()) { this.map.delete(k); return null; }
    return i.data;
  },
  set(k, v) { this.map.set(k, { data: v, expireAt: this.now() + this.ttlMs }); },
  del(k) { this.map.delete(k); },
};

const DEFAULT_STAGE = "recepcao";
const NS = process.env.FSM_NAMESPACE || "matrix:fsm";
const TTL_SEC = Number(process.env.SESSION_TTL_SECONDS || 86400);

function key(botId, userId) {
  return `${NS}:${botId}:${userId}`;
}
function newSession({ botId, userId, extra }) {
  return {
    id: crypto.randomUUID(),
    botId, userId,
    stage: DEFAULT_STAGE,
    slots: {},
    context: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  };
}

export async function getSession(botId, userId) {
  const r = await getRedis();
  const k = key(botId, userId);
  if (r) {
    const raw = await r.get(k);
    if (raw) return JSON.parse(raw);
    const s = newSession({ botId, userId });
    await r.set(k, JSON.stringify(s), { EX: TTL_SEC });
    return s;
  }
  return mem.get(k) || (mem.set(k, newSession({ botId, userId })), mem.get(k));
}

export async function updateSession(botId, userId, patch = {}) {
  const r = await getRedis();
  const k = key(botId, userId);
  if (r) {
    const s = await getSession(botId, userId);
    const merged = { ...s, ...patch, updatedAt: Date.now() };
    await r.set(k, JSON.stringify(merged), { EX: TTL_SEC });
    return merged;
  }
  const found = mem.get(k) || newSession({ botId, userId });
  const merged = { ...found, ...patch, updatedAt: Date.now() };
  mem.set(k, merged);
  return merged;
}

export async function clearSession(botId, userId) {
  const r = await getRedis();
  const k = key(botId, userId);
  if (r) await r.del(k);
  mem.del(k);
}
