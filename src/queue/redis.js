// src/queue/redis.js
import Redis from 'ioredis';

function getEnvUrl() {
  const url = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';
  if (!url) {
    throw new Error(
      '[redis][queue] Nenhuma URL definida. ' +
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

let client;

export function getRedisClient() {
  if (client) return client;

  const url = getEnvUrl();
  const useTLS = shouldUseTLS(url);

  client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    tls: useTLS ? {} : undefined,
  });

  client.on('connect', () => console.log('[redis][queue] connected'));
  client.on('error', (err) => console.error('[redis][queue][error]', err?.message || err));

  return client;
}

export default getRedisClient();
