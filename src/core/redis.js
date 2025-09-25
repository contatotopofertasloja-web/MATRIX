// src/core/redis.js — cliente ioredis com TLS opcional e helpers de fila
import IORedis from 'ioredis';

function getEnvUrl() {
  const url = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';
  if (!url) {
    throw new Error('[redis][core] Nenhuma URL definida. Defina MATRIX_REDIS_URL=${{ Redis.REDIS_PUBLIC_URL }} no Railway.');
  }
  return url.trim();
}
function shouldUseTLS(url) {
  if (url.startsWith('rediss://')) return true;
  try {
    const u = new URL(url);
    if ((u.searchParams.get('tls') || '').toLowerCase() === 'true') return true;
  } catch {}
  return false;
}

let client = null;
export function getRedis() {
  if (client) return client;
  const url = getEnvUrl();
  const useTLS = shouldUseTLS(url);
  client = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: null, enableReadyCheck: true, tls: useTLS ? {} : undefined });
  client.on('connect', () => console.log('[redis][core] connected'));
  client.on('ready', () => console.log('[redis][core] ready'));
  client.on('reconnecting', () => console.log('[redis][core] reconnecting...'));
  client.on('error', (e) => console.error('[redis][core][error]', e?.message || e));
  console.log('[redis][core] URL usado =', url.includes('proxy') ? 'public' : 'internal');
  return client;
}
export async function closeRedis() {
  if (!client) return;
  try { await client.quit(); } catch { try { client.disconnect(); } catch {} }
  client = null;
}
export function qname(suffix = '') {
  const ns = process.env.REDIS_NS || `matrix:${process.env.WPP_SESSION || 'default'}`;
  const s  = String(suffix || '').replace(/^:+/, '');
  return `${ns}:${s}`;
}
export async function qpushLeft(topic, payload) {
  const r = getRedis();
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  await r.lpush(topic, body);
}
export async function qpopRightBlocking(topic, timeoutSec = 5) {
  const r = getRedis();
  const res = await r.brpop(topic, timeoutSec);
  if (!res) return null;
  const [, body] = res;
  try { return JSON.parse(body); } catch { return body; }
}
export async function qlen(topic) {
  const r = getRedis();
  try { return await r.llen(topic); } catch { return -1; }
}
export async function getJson(key) {
  const r = getRedis();
  const raw = await r.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export async function setexJson(key, obj, ttlSec = 5) {
  const r = getRedis();
  const body = JSON.stringify(obj ?? {});
  if (ttlSec > 0) return r.setex(key, ttlSec, body);
  return r.set(key, body);
}
export default getRedis;
