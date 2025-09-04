// src/core/queue.js
// Fila Outbox p/ envio de mensagens (Redis com fallback em memória).
// - createOutbox({ topic, concurrency, redisUrl })
// - outbox.publish({ to, kind, payload })
// - outbox.start(handler)    -> handler({ to, kind, payload, _ts })
// - outbox.backend()         -> "redis" | "memory"
// - outbox.isConnected()     -> bool
// - outbox.stop()

import EventEmitter from 'node:events';

function env(name, def) {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? def : v;
}

const DEFAULT_CONCURRENCY = Number(env('QUEUE_OUTBOX_CONCURRENCY', '4'));

// -------------------- Redis impl --------------------
async function makeRedisImpl({ topic, concurrency, url }) {
  const IORedis = (await import('ioredis')).default;
  const pub = new IORedis(url);
  const sub = new IORedis(url);

  const state = {
    closing: false,
    workers: [],
    connected: false,
    backend: 'redis',
    topic,
    events: new EventEmitter(),
  };

  const markReady = () => { state.connected = true; state.events.emit('ready'); };
  const markEnd   = () => { state.connected = false; };

  pub.on('ready', markReady);
  sub.on('ready', markReady);
  pub.on('end',   markEnd);
  sub.on('end',   markEnd);

  async function publish(msg) {
    const body = JSON.stringify({ ...msg, _ts: Date.now() });
    // FIFO simples: RPUSH + BLPOP
    await pub.rpush(topic, body);
  }

  async function workerLoop(handler) {
    while (!state.closing) {
      try {
        const res = await sub.blpop(topic, 5); // bloqueia 5s
        if (!res) continue;
        const [, body] = res;
        let job;
        try { job = JSON.parse(body); } catch { continue; }
        await handler(job);
      } catch (e) {
        state.events.emit('error', e);
      }
    }
  }

  async function start(handler) {
    if (state.workers.length) return;
    for (let i = 0; i < concurrency; i++) {
      state.workers.push(workerLoop(handler).catch(() => {}));
    }
  }

  async function stop() {
    state.closing = true;
    await new Promise(r => setTimeout(r, 220)); // deixa BLPOP expirar
    pub.disconnect();
    sub.disconnect();
  }

  return {
    backend: () => state.backend,
    isConnected: () => state.connected,
    on: (...a) => state.events.on(...a),
    publish,
    start,
    stop,
  };
}

// -------------------- Memória impl --------------------
function makeMemoryImpl({ topic, concurrency }) {
  const q = [];
  const state = {
    closing: false,
    running: 0,
    backend: 'memory',
    topic,
    events: new EventEmitter(),
  };

  async function drain(handler) {
    if (state.running >= concurrency) return;
    const job = q.shift();
    if (!job) return;
    state.running++;
    try { await handler(job); }
    catch (e) { state.events.emit('error', e); }
    finally {
      state.running--;
      setImmediate(() => drain(handler));
    }
  }

  async function publish(msg) {
    q.push({ ...msg, _ts: Date.now() });
  }

  async function start(handler) {
    const tick = setInterval(() => {
      if (state.closing) return clearInterval(tick);
      while (state.running < concurrency && q.length) drain(handler);
    }, 30);
  }

  async function stop() { state.closing = true; }

  return {
    backend: () => state.backend,
    isConnected: () => true,
    on: (...a) => state.events.on(...a),
    publish,
    start,
    stop,
  };
}

// -------------------- Factory --------------------
export async function createOutbox({
  topic = env('OUTBOX_TOPIC', `outbox:${env('WPP_SESSION', 'default')}`),
  concurrency = DEFAULT_CONCURRENCY,
  redisUrl = env('REDIS_URL', ''),
} = {}) {
  if (redisUrl) {
    try {
      return await makeRedisImpl({ topic, concurrency, url: redisUrl });
    } catch (e) {
      console.warn('[queue] Redis indisponível, usando memória:', e?.message || e);
    }
  }
  return makeMemoryImpl({ topic, concurrency });
}
