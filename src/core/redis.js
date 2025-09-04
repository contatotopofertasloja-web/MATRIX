// src/core/redis.js
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || null;
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const REDIS_DB   = Number(process.env.REDIS_DB || 0);
const REDIS_PASS = process.env.REDIS_PASS || undefined;
- const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
+ const REDIS_URL = process.env.REDIS_URL || '';


export const redis = REDIS_URL
  ? new IORedis(REDIS_URL)
  : new IORedis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      db:   REDIS_DB,
      password: REDIS_PASS,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });

redis.on('connect', () => console.log('[redis] connected'));
redis.on('error', (e) => console.error('[redis] error', e?.message || e));
