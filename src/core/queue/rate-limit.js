// src/core/queue/rate-limit.js
// Token bucket simplificado em janela curta (TTL 5s) — robusto sem Redis.

import { getRedis, qname } from './redis.js';

const TTL_SEC = 5; // janela dos "tokens"

export async function allowSend({ topic, ratePerSec = 0.5 }) {
  if (!ratePerSec || ratePerSec <= 0) return true;
  const redis = await getRedis?.();
  if (!redis) return true; // sem Redis → não bloqueia

  const bucket = qname(`ratelimit:${topic}`);
  const capacity = 5;
  const refillPerSec = ratePerSec;

  const keyUsed = `${bucket}:used`;
  const used = await redis.incr(keyUsed);
  if (used === 1) await redis.expire(keyUsed, TTL_SEC);

  const ttl = await redis.ttl(keyUsed);
  const secLived = TTL_SEC - (ttl < 0 ? 0 : ttl);
  const allowed = Math.floor(Math.min(capacity, secLived * refillPerSec + 1));

  const ok = used <= allowed;
  if (!ok) {
    console.warn(`[rate-limit/redis] BLOCK topic=${topic} used=${used} allowed=${allowed}`);
  }
  return ok;
}
