// src/core/queue/redis.js
// Backend Redis para a fila baseada em LIST (LPUSH/BRPOP).
// Reaproveita o singleton oficial do core para não duplicar conexões.

import { getRedis as getCoreRedis } from '../redis.js';

export const PREFIX = process.env.QUEUE_PREFIX || `q:${process.env.WPP_SESSION || 'default'}`;

// Client único (do core)
export function getRedis() {
  return getCoreRedis();
}

// Alias de compat (alguns módulos legados esperam "redis")
export const redis = getCoreRedis();

// Monta nome padronizado das chaves
export function qname(subkey = '') {
  const key = String(subkey || '').replace(/^\:+/, '');
  return `${PREFIX}:${key}`;
}

// Enfileira no INÍCIO (LPUSH) — consumidor fará BRPOP no fim
export async function qpushLeft(topic, jobObj) {
  const key = qname(topic);
  const payload = JSON.stringify(jobObj);
  const r = getCoreRedis();
  await r.lpush(key, payload);

  const ttlSec = Number(process.env.QUEUE_TTL_SEC || 0);
  if (ttlSec > 0) await r.expire(key, ttlSec);

  return true;
}

// BRPOP com timeout em segundos — retorna o job (objeto) ou null
export async function qpopRightBlocking(topic, timeoutSec = 5) {
  const key = qname(topic);
  const r = getCoreRedis();
  const res = await r.brpop(key, timeoutSec); // [key, value] ou null
  if (!res || !Array.isArray(res) || res.length < 2) return null;
  const raw = res[1];
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[queue][redis] JSON inválido em BRPOP:', e?.message || e);
    return null;
  }
}
