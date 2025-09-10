// src/core/queue/dispatcher.js
// Outbox com Redis (LIST LPUSH/BRPOP) + rate-limit distribuído + retries + DLQ opcional.
// API: enqueueOutbox({ topic, to, content, meta? }), startOutboxWorkers({ topic, concurrency?, ratePerSec?, sendFn, ...opts })
//
// Recursos:
// - Retries com backoff exponencial + jitter
// - Dead-letter queue (DLQ) opcional: <topic>:dlq
// - Min gap global e por destinatário (além do ratePerSec)
// - Logs de correlação por job.id
//
// ENV (opcionais):
//   QUEUE_OUTBOX_RETRIES=2
//   QUEUE_OUTBOX_RETRY_DELAY_MS=1000
//   QUEUE_OUTBOX_MIN_GAP_GLOBAL_MS=300
//   QUEUE_OUTBOX_MIN_GAP_MS=1500
//   QUEUE_OUTBOX_CONCURRENCY=1
//   QUEUE_OUTBOX_DLQ_ENABLED=true|false

import { qpushLeft, qpopRightBlocking, qlen, getJson, setexJson } from '../redis.js';
import { allowSend } from '../rate-limit.js';

const envNum = (k, d) => (Number.isFinite(+process.env[k]) ? +process.env[k] : d);
const envBool = (k, d=false) => ['1','true','yes','y','on'].includes(String(process.env[k]||'').toLowerCase());

const DEFAULTS = {
  RETRIES: envNum('QUEUE_OUTBOX_RETRIES', 2),
  RETRY_DELAY_MS: envNum('QUEUE_OUTBOX_RETRY_DELAY_MS', 1000),
  MIN_GAP_GLOBAL_MS: envNum('QUEUE_OUTBOX_MIN_GAP_GLOBAL_MS', 300),
  MIN_GAP_MS: envNum('QUEUE_OUTBOX_MIN_GAP_MS', 1500),
  CONCURRENCY: envNum('QUEUE_OUTBOX_CONCURRENCY', 1),
  DLQ_ENABLED: envBool('QUEUE_OUTBOX_DLQ_ENABLED', true),
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (ms, pct=0.2) => {
  const j = Math.floor(ms * pct);
  return Math.max(0, ms + (Math.floor(Math.random() * (2*j + 1)) - j));
};

// ---------------- Enqueue ----------------
export async function enqueueOutbox({ topic, to, content, meta = {} }) {
  if (!topic) throw new Error('enqueueOutbox: topic obrigatório');
  if (!to) throw new Error('enqueueOutbox: to obrigatório');
  if (content == null) throw new Error('enqueueOutbox: content obrigatório');

  const job = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    to,
    content,
    meta: { tries: 0, ...meta },
  };
  await qpushLeft(topic, job);
  return { ok: true, enqueued: true, topic, id: job.id };
}

// ---------------- Workers ----------------
export async function startOutboxWorkers({
  topic,
  concurrency = DEFAULTS.CONCURRENCY,
  ratePerSec = 0.5,
  sendFn,
  minGapMs = DEFAULTS.MIN_GAP_MS,
  minGapGlobalMs = DEFAULTS.MIN_GAP_GLOBAL_MS,
  maxRetries = DEFAULTS.RETRIES,
  baseRetryDelayMs = DEFAULTS.RETRY_DELAY_MS,
  dlqEnabled = DEFAULTS.DLQ_ENABLED,
} = {}) {
  if (!topic) throw new Error('startOutboxWorkers: topic obrigatório');
  if (typeof sendFn !== 'function') throw new Error('startOutboxWorkers: sendFn obrigatório');

  for (let i = 0; i < concurrency; i++) {
    loop({
      topic,
      wid: i,
      ratePerSec,
      sendFn,
      minGapMs,
      minGapGlobalMs,
      maxRetries,
      baseRetryDelayMs,
      dlqEnabled,
    }).catch((e) => console.error(`[outbox:${topic}][w${i}] loop error`, e?.stack || e));
  }
}

// ---------------- Loop principal ----------------
async function loop(opts) {
  const {
    topic, wid, ratePerSec, sendFn,
    minGapMs, minGapGlobalMs, maxRetries, baseRetryDelayMs, dlqEnabled,
  } = opts;

  const GAP_GLOBAL_KEY = `outbox:${topic}:gap:global`;

  while (true) {
    try {
      const job = await qpopRightBlocking(topic, 5); // aguarda até 5s
      if (!job) continue;

      // 1) rate-limit distribuído
      const allowed = await allowSend({ topic, ratePerSec });
      if (!allowed) {
        await requeueWithBackoff(topic, job, 1000);
        continue;
      }

      const now = Date.now();

      // 2) min-gap global
      const lastGlobal = await readJson(GAP_GLOBAL_KEY);
      if (lastGlobal?.at && now - lastGlobal.at < minGapGlobalMs) {
        const wait = Math.max(0, minGapGlobalMs - (now - lastGlobal.at));
        await requeueWithBackoff(topic, job, wait);
        continue;
      }

      // 3) min-gap por destinatário
      const gapKeyPerTo = `outbox:${topic}:gap:${normalizeTo(job.to)}`;
      const lastPerTo = await readJson(gapKeyPerTo);
      if (lastPerTo?.at && now - lastPerTo.at < minGapMs) {
        const wait = Math.max(0, minGapMs - (now - lastPerTo.at));
        await requeueWithBackoff(topic, job, wait);
        continue;
      }

      // 4) envio
      try {
        await sendFn(job.to, job.content);

        // sucesso → grava gaps (usa TTL próximo ao gap)
        await writeJson(GAP_GLOBAL_KEY, { at: Date.now() }, Math.ceil(minGapGlobalMs/1000)+2);
        await writeJson(gapKeyPerTo, { at: Date.now() }, Math.ceil(minGapMs/1000)+2);
      } catch (sendErr) {
        const tries = (job.meta?.tries ?? 0) + 1;
        job.meta = { ...(job.meta || {}), tries };
        const errMsg = sendErr?.message || String(sendErr);

        if (tries > maxRetries) {
          if (dlqEnabled) {
            await pushDLQ(topic, { ...job, error: errMsg });
            console.error(`[outbox:${topic}][w${wid}][${job.id}] DLQ after ${tries} tries: ${errMsg}`);
          } else {
            console.error(`[outbox:${topic}][w${wid}][${job.id}] dropped after ${tries} tries: ${errMsg}`);
          }
          continue;
        }

        const delay = jitter(baseRetryDelayMs * Math.pow(2, Math.min(tries - 1, 3)));
        console.warn(`[outbox:${topic}][w${wid}][${job.id}] retry ${tries}/${maxRetries} in ~${delay}ms: ${errMsg}`);
        await requeueWithBackoff(topic, job, delay);
      }
    } catch (e) {
      console.error(`[outbox:${topic}][w${wid}] loop exception`, e?.message || e);
      await sleep(500);
    }
  }
}

// ---------------- Helpers Redis JSON ----------------
async function readJson(key) {
  try { if (typeof getJson === 'function') return await getJson(key); } catch {}
  return null;
}
async function writeJson(key, obj, ttlSec = 5) {
  try { if (typeof setexJson === 'function') return await setexJson(key, obj, ttlSec); } catch {}
}

// ---------------- Helpers requeue/DLQ ----------------
async function requeueWithBackoff(topic, job, waitMs) {
  await sleep(Math.min(5000, Math.max(25, waitMs || 0)));
  await qpushLeft(topic, job);
}
async function pushDLQ(topic, job) {
  try { await qpushLeft(`${topic}:dlq`, job); } catch (e) {
    console.error(`[outbox:${topic}] DLQ push error`, e?.message || e);
  }
}

function normalizeTo(to) {
  return String(to || '').replace(/\D/g, '') || 'unknown';
}

// ---------------- Util ----------------
export async function queueSize(topic) {
  try { return await qlen(topic); } catch { return -1; }
}

export default { enqueueOutbox, startOutboxWorkers, queueSize };
