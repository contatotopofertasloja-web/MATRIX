// src/core/rateLimit.js
// Orquestrador de rate-limit: Redis (preferencial) + fallback memória.
// src/core/rate-limit.js
// Shim de compat: reexporta o módulo camelCase para evitar "module not found".
export * from './rateLimit.js';
export { default } from './rateLimit.js';

import { allowSend as allowSendRedis } from './queue/rate-limit.js';

const buckets = new Map(); // fallback memória: topic -> { used:number, stamp:number }
const TTL_MS = 5000;

function allowSendMem({ topic, ratePerSec = 0.5 }) {
  if (!ratePerSec || ratePerSec <= 0) return true;
  const now = Date.now();
  const cap = 5;                       // capacidade da janela
  const refill = ratePerSec;           // tokens/s
  let b = buckets.get(topic);
  if (!b || now - b.stamp > TTL_MS) { b = { used: 0, stamp: now }; buckets.set(topic, b); }
  b.used += 1;
  const lived = Math.min(TTL_MS, now - b.stamp) / 1000;
  const allowed = Math.floor(Math.min(cap, lived * refill + 1));
  return b.used <= allowed;
}

/**
 * Verifica se pode enviar neste tópico.
 * Se Redis estiver acessível em queue/rate-limit, usa lá; senão, fallback memória.
 */
export async function allowSend({ topic, ratePerSec = 0.5 }) {
  try {
    // Tenta caminho Redis (se getRedis() estiver configurado lá dentro)
    const ok = await allowSendRedis({ topic, ratePerSec });
    // Se o módulo retornou boolean explícito, respeita. Se lançar erro, cai no catch.
    if (typeof ok === 'boolean') return ok;
  } catch {}
  // Fallback memória
  return allowSendMem({ topic, ratePerSec });
}
