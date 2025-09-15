// src/core/memory.js
import { BOT_ID } from "./settings.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TTL_MS = Number(process.env.MEMORY_TTL_MS || SEVEN_DAYS_MS);

// --- Redis opcional (node-redis). Se não estiver instalado, cai pra RAM sem erro.
let redis = null;
let useRedis = false;
let redisPrefix = `matrix:mem:${BOT_ID || "default"}:`;

try {
  const url = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL;
  if (url) {
    // tenta node-redis primeiro (matching com package atualizado)
    const mod = await import("redis").catch(() => null);
    if (mod?.createClient) {
      const { createClient } = mod;
      redis = createClient({ url });
      redis.on("error", (e) => console.warn("[memory] redis error:", e?.message || e));
      await redis.connect();
      useRedis = true;
      console.log("[memory] usando Redis para memória volátil (TTL 7d)");
    }
  }
} catch (e) {
  console.warn("[memory] Redis indisponível, usando memória RAM:", e?.message || e);
}

// --- RAM fallback
const store = new Map(); // jid -> { ...data, _expiresAt }
let sweeperStarted = false;
function startSweeper() {
  if (sweeperStarted) return;
  sweeperStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [jid, obj] of store.entries()) {
      if ((obj?._expiresAt || 0) < now) store.delete(jid);
    }
  }, Math.min(TTL_MS, 60 * 60 * 1000));
}

function fresh(obj) { return { ...(obj || {}), _expiresAt: Date.now() + TTL_MS }; }
function key(jid) { return `${redisPrefix}${jid}`; }

export async function get(jid) {
  if (useRedis) {
    try {
      const raw = await redis.get(key(jid));
      if (!raw) return { slots: {} };
      return JSON.parse(raw);
    } catch (e) { console.warn("[memory.get] redis:", e?.message || e); }
  }
  startSweeper();
  const cur = store.get(jid);
  if (!cur) return { slots: {} };
  if (Date.now() > (cur._expiresAt || 0)) { store.delete(jid); return { slots: {} }; }
  return cur;
}

export async function set(jid, data) {
  const payload = fresh(data);
  if (useRedis) {
    try { await redis.set(key(jid), JSON.stringify(payload), { EX: Math.ceil(TTL_MS / 1000) }); return; }
    catch (e) { console.warn("[memory.set] redis:", e?.message || e); }
  }
  startSweeper();
  store.set(jid, payload);
}

export async function merge(jid, patch) {
  const cur = await get(jid);
  await set(jid, { ...(cur || {}), ...(patch || {}) });
}

export async function clear(jid) {
  if (useRedis) { try { await redis.del(key(jid)); return; } catch {} }
  store.delete(jid);
}

export function ttlInfo() {
  return { ttl_ms: TTL_MS, ttl_days: +(TTL_MS / (24*60*60*1000)).toFixed(2), backend: useRedis ? "redis" : "ram" };
}
