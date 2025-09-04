// src/queue/redis.js
import Redis from 'ioredis';

/**
 * Removido fallback hardcoded para localhost.
 * Em DEV, se quiser usar Redis local, defina REDIS_URL no .env (apenas em dev).
 */
const REDIS_URL = process.env.REDIS_URL || '';

let client;

/**
 * Retorna (ou cria) um cliente ioredis singleton para outras filas/consumidores.
 * - TLS automático quando for rediss://
 */
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

// Compat: export default para usos antigos (import client from ...)
export default getRedisClient();
