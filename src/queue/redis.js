// src/queue/redis.js
import Redis from 'ioredis';

// Override seguro primeiro
const REDIS_URL = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';

let client;

/** Cliente Redis para publishers/consumers auxiliares */
export function getRedisClient() {
  if (client) return client;

  if (!REDIS_URL) {
    throw new Error('[redis] REDIS_URL não definido no ambiente');
  }

  const useTLS = REDIS_URL.startsWith('rediss://');

  client = new Redis(REDIS_URL, {
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
