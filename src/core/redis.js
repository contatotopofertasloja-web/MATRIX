// src/core/redis.js
import IORedis from 'ioredis';

/**
 * Lê MATRIX_REDIS_URL como prioridade.
 * Se não achar, cai no REDIS_URL (que o Railway injeta automático).
 */
function getEnvUrl() {
  const url = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';
  if (!url) {
    throw new Error(
      '[redis][core] Nenhuma URL definida. ' +
      'Defina MATRIX_REDIS_URL=${{ Redis.REDIS_PUBLIC_URL }} no Railway.'
    );
  }
  return url.trim();
}

function shouldUseTLS(url) {
  if (url.startsWith('rediss://')) return true;
  try {
    const u = new URL(url);
    if ((u.searchParams.get('tls') || '').toLowerCase() === 'true') return true;
  } catch (_) {}
  return false;
}

let client = null;

export function getRedis() {
  if (client) return client;

  const url = getEnvUrl();
  const useTLS = shouldUseTLS(url);

  client = new IORedis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    tls: useTLS ? {} : undefined,
  });

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

export default getRedis;
