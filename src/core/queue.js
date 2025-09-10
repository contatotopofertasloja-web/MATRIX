// src/core/queue.js — Outbox robusto (Redis List com fallback em memória)
//
// API:
//   const outbox = await createOutbox({ topic, concurrency, redisUrl })
//   await outbox.start(async (job) => { ... })   // job = { to, kind, payload, _ts }
//   await outbox.publish({ to, kind, payload })
//   outbox.isConnected() -> boolean
//   outbox.backend()     -> { driver: 'redis-list'|'memory', topic }
//   await outbox.stop()

import Redis from 'ioredis';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = (k, d='') => (process.env[k] ?? d);

function makeRedisClient(url, label) {
  const useTLS = url.startsWith('rediss://');
  const opts = {
    lazyConnect: false,
    enableReadyCheck: true,
    connectTimeout: 8000,
    keepAlive: 15000,
    maxRetriesPerRequest: null,
    autoResubscribe: true,
    autoResendUnfulfilledCommands: true,
    retryStrategy: (times) => Math.min(30000, 1000 + times * 500),
    reconnectOnError: (err) => {
      const code = err?.code || '';
      const msg  = String(err?.message || '');
      return (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT' || msg.includes('READONLY'));
    },
    tls: useTLS ? { rejectUnauthorized: false } : undefined,
  };

  const r = new Redis(url, opts);
  r.on('connect', () => console.log(`[redis][${label}] connected`));
  r.on('ready',   () => console.log(`[redis][${label}] ready`));
  r.on('end',     () => console.warn(`[redis][${label}] connection ended`));
  r.on('error',   (e) => console.warn(`[redis][${label}] error:`, e?.code || e?.message || e));
  return r;
}

function makeMemoryImpl({ topic, concurrency }) {
  const q = [];
  let closing = false;
  let running = 0;

  async function drain(handler) {
    if (running >= concurrency) return;
    const job = q.shift();
    if (!job) return;
    running++;
    try { await handler(job); }
    catch (e) { console.error('[outbox][mem][handler]', e?.message || e); }
    finally { running--; setImmediate(() => drain(handler)); }
  }

  return {
    backend: () => ({ driver: 'memory', topic }),
    isConnected: () => true,
    async publish(msg) { q.push({ ...msg, _ts: Date.now() }); },
    async start(handler) {
      console.log(`[outbox] memory backend start (topic=${topic})`);
      const tick = setInterval(() => {
        if (closing) return clearInterval(tick);
        while (running < concurrency && q.length) drain(handler);
      }, 25);
    },
    async stop() { closing = true; },
  };
}

async function makeRedisImpl({ topic, concurrency, url }) {
  const cmd = makeRedisClient(url, 'outbox');
  const blk = makeRedisClient(url, 'outboxB');

  let closing = false;

  async function publish(msg) {
    try {
      const body = JSON.stringify({ ...msg, _ts: Date.now() });
      await cmd.lpush(topic, body); // FIFO com LPUSH + BRPOP no mesmo tópico
      return true;
    } catch (e) {
      console.error('[outbox][publish]', e?.message || e);
      return false;
    }
  }

  async function workerLoop(id, handler) {
    console.log(`[outbox] worker #${id} start (topic=${topic})`);
    while (!closing) {
      try {
        if (blk.status !== 'ready') { await sleep(250); continue; }
        const res = await blk.brpop(topic, 5); // 5s timeout
        if (!res) continue;
        const [, body] = res;
        let job = null;
        try { job = JSON.parse(body); } catch { /* drop */ }
        if (job) {
          try { await handler(job); }
          catch (e) { console.error('[outbox][handler]', e?.message || e); }
        }
      } catch (e) {
        console.warn('[outbox][loop]', e?.code || e?.message || e);
        await sleep(300);
      }
    }
    console.log(`[outbox] worker #${id} stop`);
  }

  return {
    backend: () => ({ driver: 'redis-list', topic }),
    isConnected: () => cmd.status === 'ready' && blk.status === 'ready',
    publish,
    async start(handler) {
      const conc = Math.max(1, Number(concurrency) || 1);
      for (let i = 0; i < conc; i++) workerLoop(i + 1, handler);
      console.log(`[outbox] redis backend start (topic=${topic}, concurrency=${conc})`);
    },
    async stop() {
      closing = true;
      await sleep(220);
      try { cmd.disconnect(); } catch {}
      try { blk.disconnect(); } catch {}
    },
  };
}

export async function createOutbox({
  topic = env('OUTBOX_TOPIC', `outbox:${env('WPP_SESSION', 'default')}`),
  concurrency = Number(env('QUEUE_OUTBOX_CONCURRENCY', '4')),
  redisUrl = env('MATRIX_REDIS_URL', env('REDIS_URL', '')),
} = {}) {
  if (redisUrl) {
    try {
      return await makeRedisImpl({ topic, concurrency, url: redisUrl });
    } catch (e) {
      console.warn('[outbox] Redis indisponível, usando memória:', e?.message || e);
    }
  }
  console.warn('[outbox] redisUrl ausente — fallback em memória');
  return makeMemoryImpl({ topic, concurrency });
}
