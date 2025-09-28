// [MATRIX_STAMP:queue v2.0] src/core/queue/dispatcher.js
// Outbox simples com backend Redis ou memória (fallback).
// Corrige imports quebrados (nada de "core/core/...") e remove self-import.

import Redis from 'ioredis';
import crypto from 'node:crypto';

const REDIS_URL = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';
const USE_REDIS = !!REDIS_URL;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function createOutbox({ topic, concurrency = 4, redisUrl = REDIS_URL } = {}) {
  if (!topic || typeof topic !== 'string') {
    throw new Error('createOutbox: informe um "topic" (ex.: outbox:producao-001a).');
  }

  // -------- Redis backend --------
  if (USE_REDIS || redisUrl) {
    const url = redisUrl || REDIS_URL;
    const useTLS = url.startsWith('rediss://');
    const redis = new Redis(url, {
      lazyConnect: false,
      enableReadyCheck: true,
      connectTimeout: 8000,
      maxRetriesPerRequest: null,
      autoResubscribe: true,
      retryStrategy: (times) => Math.min(30000, 1000 + times * 500),
      tls: useTLS ? { rejectUnauthorized: false } : undefined,
    });
    const key = `${topic}:queue`;
    const group = process.env.OUTBOX_GROUP || 'g1';
    const consumer = `${group}-${crypto.randomUUID().slice(0, 8)}`;

    let running = false;

    async function ensureStream() {
      try {
        await redis.xgroup('CREATE', key, group, '$', 'MKSTREAM');
      } catch (e) {
        // group may already exist
      }
    }

    async function publish(job) {
      const payload = JSON.stringify(job || {});
      await redis.xadd(key, '*', 'p', payload);
    }

    async function start(worker) {
      await ensureStream();
      running = true;

      const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
        while (running) {
          try {
            const res = await redis.xreadgroup(
              'GROUP', group, consumer,
              'BLOCK', 5000,
              'COUNT', 1,
              'STREAMS', key, '>'
            );
            if (!res || !res.length) continue;

            for (const [, entries] of res) {
              for (const [id, fields] of entries) {
                const payload = fields[1] ? JSON.parse(fields[1]) : {};
                try {
                  await Promise.resolve(worker(payload));
                  await redis.xack(key, group, id);
                } catch (err) {
                  // pequeno retry: reanexa no fim do stream
                  await redis.xack(key, group, id);
                  await redis.xadd(key, '*', 'p', JSON.stringify(payload));
                }
              }
            }
          } catch {
            await sleep(800);
          }
        }
      });

      await Promise.allSettled(workers);
    }

    async function close() {
      running = false;
      try { await redis.quit(); } catch {}
    }

    function backend() { return 'redis'; }
    function isConnected() { return redis.status === 'ready'; }

    return { publish, start, close, backend, isConnected };
  }

  // -------- Memória (fallback) --------
  const q = [];
  let running = false;

  async function publish(job) { q.push(job); }

  async function start(worker) {
    running = true;
    const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (running) {
        const job = q.shift();
        if (!job) { await sleep(100); continue; }
        try { await Promise.resolve(worker(job)); }
        catch { /* solta no chão no fallback */ }
      }
    });
    await Promise.allSettled(workers);
  }

  async function close() { running = false; }
  function backend() { return 'memory'; }
  function isConnected() { return true; }

  return { publish, start, close, backend, isConnected };
}
