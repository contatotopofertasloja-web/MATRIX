import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
const KEY_PREFIX = process.env.REDIS_PREFIX || 'matrix';

let client;

export function getRedis() {
  if (client) return client;
  client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });

  client.on('connect', () => console.log('[redis] connect'));
  client.on('ready',   () => console.log('[redis] ready'));
  client.on('error',   (e) => console.error('[redis] error', e?.message || e));
  client.on('end',     () => console.warn('[redis] end'));

  return client;
}

export function qname(name) {
  return `${KEY_PREFIX}:${name}`;
}

export async function qpushLeft(queue, payload) {
  const redis = getRedis();
  return redis.lpush(qname(queue), JSON.stringify(payload));
}

export async function qpopRightBlocking(queue, timeoutSec = 5) {
  const redis = getRedis();
  const res = await redis.brpop(qname(queue), timeoutSec);
  if (!res) return null;
  try { return JSON.parse(res[1]); } catch { return null; }
}
