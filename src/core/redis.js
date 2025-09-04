// src/core/queue/redis.js
import Redis from 'ioredis';

/**
 * NUNCA force fallback para localhost em produção.
 * Se REDIS_URL não vier do ambiente, deixamos vazio
 * e o serviço deve falhar visivelmente (melhor do que
 * conectar no lugar errado).
 */
const REDIS_URL = process.env.REDIS_URL || '';

let client;

/**
 * Retorna (ou cria) um cliente ioredis singleton.
 * - Ativa TLS automaticamente se a URL começar com rediss://
 */
export function getRedis() {
  if (client) return client;

  if (!REDIS_URL) {
    throw new Error('[redis] REDIS_URL não definido no ambiente');
  }

  const useTLS = REDIS_URL.startsWith('rediss://');

  client = new Redis(REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: null, // evita timeout de pipeline
    enableReadyCheck: true,
    tls: useTLS ? {} : undefined,
  });

  client.on('connect', () => console.log('[redis][core/queue] connected'));
  client.on('error', (err) => console.error('[redis][core/queue][error]', err?.message || err));

  return client;
}

// Compat: export default mantém módulos antigos funcionando
export default getRedis();
