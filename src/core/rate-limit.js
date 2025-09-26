// src/core/rateLimit.js
// Orquestrador de rate-limit: Redis (preferencial) + fallback memória.

export * from './rateLimit.js';
export { default } from './rateLimit.js';

import { allowSend as allowSendRedis } from './queue/rate-limit.js';

const buckets = new Map(); // fallback memória: topic -> { used:number, stamp:number }
const TTL_MS = 5000;

function allowSendMem({ topic, ratePerSec = 0.5 }) {
  if (!ratePerSec || ratePerSec <= 0) return true;
  const now = Date.now();
  const cap = 5;
  const refill = ratePerSec;
  let b = buckets.get(topic);
  if (!b || now - b.stamp > TTL_MS) {
    b = { used: 0, stamp: now };
    buckets.set(topic, b);
  }
  b.used += 1;
  const lived = Math.min(TTL_MS, now - b.stamp) / 1000;
  const allowed = Math.floor(Math.min(cap, lived * refill + 1));
  const ok = b.used <= allowed;
  if (!ok) {
    console.warn(`[rate-limit/mem] BLOCK topic=${topic} used=${b.used} allowed=${allowed}`);
  }
  return ok;
}

/**
 * Verifica se pode enviar neste tópico.
 * Se Redis estiver acessível em queue/rate-limit, usa lá; senão, fallback memória.
 */
export async function allowSend({ topic, ratePerSec = 0.5 }) {
  try {
    const ok = await allowSendRedis({ topic, ratePerSec });
    if (typeof ok === 'boolean') {
      if (!ok) console.warn(`[rate-limit/redis] BLOCK topic=${topic} rate=${ratePerSec}/s`);
      return ok;
    }
  } catch (e) {
    console.warn("[rate-limit] Redis indisponível, usando fallback:", e?.message || e);
  }
  return allowSendMem({ topic, ratePerSec });
}
