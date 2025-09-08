// src/queue/redis.js
// Shim: redireciona para o singleton do core (evita 2 conexões e APIs diferentes).
export { getRedis as getRedisClient } from '../core/redis.js';
export { default as default } from '../core/redis.js';
