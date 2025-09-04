// src/core/redis.js
import IORedis from 'ioredis';

/**
 * Resolve a URL de conexão priorizando um override seguro.
 * - Em produção, defina MATRIX_REDIS_URL ou REDIS_URL nas Variables do serviço.
 * - Em dev, se quiser Redis local, defina REDIS_URL no .env (apenas em dev).
 */
function resolveRedisUrl() {
  return (
    process.env.MATRIX_REDIS_URL ||
    process.env.REDIS_URL ||
    ''
  );
}

let client = null;

/**
 * Singleton com conexão LAZY:
 * Só instancia quando alguém chama getRedis() pela 1ª vez.
 */
export function getRedis() {
  if (client) return client;

  const url = resolveRedisUrl();
  if (!url) {
    throw new Error('[redis] REDIS_URL não definido no ambiente');
  }

  const useTLS = url.startsWith('rediss://');

  client = new IORedis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    tls: useTLS ? {} : undefined,
  });

  // Logs básicos
  client.on('connect',   () => console.log('[redis][core] connected'));
  client.on('ready',     () => console.log('[redis][core] ready'));
  client.on('reconnecting', (t) => console.log('[redis][core] reconnecting', t));
  client.on('error',     (e) => console.error('[redis][core][error]', e?.message || e));

  // Diagnóstico amigável na subida
  const tag =
    url.includes('redis.railway.internal') ? 'internal'
    : url.startsWith('rediss://') ? 'public+TLS'
    : 'custom/env';
  console.log('[ENV] REDIS_URL effective:', tag);

  return client;
}

/** Fecha a conexão (útil em testes/shutdowns) */
export async function closeRedis() {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    try { await client.disconnect(); } catch {}
  } finally {
    client = null;
  }
}

// Compatibilidade: alguns módulos podem importar default
export default getRedis;
