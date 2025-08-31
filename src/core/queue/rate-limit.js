import { getRedis, qname } from './redis.js';

const TTL_SEC = 5;

export async function allowSend({ topic, ratePerSec = 0.5 }) {
  if (!ratePerSec || ratePerSec <= 0) return true;
  const redis = getRedis();

  const bucket = qname(`ratelimit:${topic}`);
  const capacity = 5;
  const refillPerSec = ratePerSec;

  const keyUsed = `${bucket}:used`;
  const used = await redis.incr(keyUsed);
  if (used === 1) await redis.expire(keyUsed, TTL_SEC);

  const ttl = await redis.ttl(keyUsed);
  const secLived = TTL_SEC - (ttl < 0 ? 0 : ttl);
  const allowed = Math.floor(Math.min(capacity, secLived * refillPerSec + 1));

  return used <= allowed;
}
