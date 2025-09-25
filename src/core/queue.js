// src/core/queue.js — Outbox auto-seletivo (ioredis -> redis -> memória)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let IORedis = null;
let RedisV4 = null;
try { const mod = await import('ioredis'); IORedis = mod?.default || mod; } catch {}
if (!IORedis) { try { const mod = await import('redis'); RedisV4 = mod; } catch {} }

// Estado global
let _globalOutboxController = null;
export function _getGlobalOutboxController() { return _globalOutboxController; }
export function _setGlobalOutboxController(c) { _globalOutboxController = c; }

// ===== Backends =====
function makeMemoryOutbox({ topic = 'outbox:default', concurrency = 1 } = {}) {
  const q = [];
  let running = false;
  let workers = [];
  let handler = async () => {};
  let connected = true;
  async function loop() {
    while (running) {
      const job = q.shift();
      if (!job) { await sleep(150); continue; }
      try { await handler(job); } catch (e) { console.warn('[outbox:mem] job error:', e?.message || e); }
    }
  }
  return {
    backend: () => 'memory',
    isConnected: () => connected,
    async start(fn) {
      handler = typeof fn === 'function' ? fn : handler;
      running = true;
      workers = Array.from({ length: Math.max(1, Number(concurrency) || 1) }, () => loop());
    },
    async publish(job) { q.push(job); },
    async stop() { running = false; connected = false; },
    _topic: topic,
  };
}

function makeIORedisOutbox({ topic = 'outbox:default', concurrency = 1, redisUrl }) {
  const key = `queue:${topic}`;
  const client = new IORedis(redisUrl);
  let running = false;
  let handler = async () => {};
  let workers = [];
  client.on('error', (e) => console.warn('[outbox:ioredis] error:', e?.message || e));
  client.on('end',   () => console.log('[outbox:ioredis] connection ended'));
  async function worker() {
    while (running) {
      try {
        const res = await client.brpop(key, 5);
        if (!res) continue;
        const payload = res[1];
        let job = null;
        try { job = JSON.parse(payload); } catch { job = null; }
        if (job) await handler(job);
      } catch (e) { console.warn('[outbox:ioredis] worker err:', e?.message || e); await sleep(300); }
    }
  }
  return {
    backend: () => 'ioredis',
    isConnected: () => client?.status === 'ready',
    async start(fn) {
      handler = typeof fn === 'function' ? fn : handler;
      running = true;
      workers = Array.from({ length: Math.max(1, Number(concurrency) || 1) }, () => worker());
    },
    async publish(job) { await client.lpush(key, JSON.stringify(job)); },
    async stop() { running = false; try { await client.quit(); } catch {} },
    _topic: topic,
  };
}

function makeNodeRedisOutbox({ topic = 'outbox:default', concurrency = 1, redisUrl }) {
  const key = `queue:${topic}`;
  const client = RedisV4.createClient({ url: redisUrl });
  let running = false;
  let handler = async () => {};
  let workers = [];
  client.on('error', (e) => console.warn('[outbox:redis] error:', e?.message || e));
  async function brpop(timeout = 5) {
    const res = await client.sendCommand(['BRPOP', key, String(timeout)]);
    if (!res) return null;
    return res; // [list, payload]
  }
  async function worker() {
    while (running) {
      try {
        const res = await brpop(5);
        if (!res) continue;
        const payload = res[1];
        let job = null;
        try { job = JSON.parse(payload); } catch { job = null; }
        if (job) await handler(job);
      } catch (e) { console.warn('[outbox:redis] worker err:', e?.message || e); await sleep(300); }
    }
  }
  return {
    backend: () => 'redis',
    isConnected: () => client?.isOpen === true,
    async start(fn) {
      await client.connect();
      handler = typeof fn === 'function' ? fn : handler;
      running = true;
      workers = Array.from({ length: Math.max(1, Number(concurrency) || 1) }, () => worker());
    },
    async publish(job) { await client.lPush(key, JSON.stringify(job)); },
    async stop() { running = false; try { await client.quit(); } catch {} },
    _topic: topic,
  };
}

// ===== Factory principal =====
export function createOutbox({ topic = 'outbox:default', concurrency = 1, redisUrl = '' } = {}) {
  let ctrl = null;
  if (redisUrl && IORedis)       ctrl = makeIORedisOutbox({ topic, concurrency, redisUrl });
  else if (redisUrl && RedisV4?.createClient) ctrl = makeNodeRedisOutbox({ topic, concurrency, redisUrl });
  else ctrl = makeMemoryOutbox({ topic, concurrency });

  ctrl.backend     = ctrl.backend     || (() => (IORedis ? 'ioredis' : (RedisV4 ? 'redis' : 'memory')));
  ctrl.isConnected = ctrl.isConnected || (() => true);
  ctrl.publish     = ctrl.publish     || (async () => {});
  ctrl.start       = ctrl.start       || (async () => {});
  ctrl.stop        = ctrl.stop        || (async () => {});

  _setGlobalOutboxController(ctrl);
  return ctrl;
}
