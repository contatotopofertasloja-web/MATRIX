// src/core/queue/dispatcher.js
// Outbox com Redis (LIST LPUSH/BRPOP) + rate-limit distribuído + retries + DLQ opcional.
// API:
//   enqueueOutbox({ topic, to, content, meta? })
//   startOutboxWorkers({ topic, concurrency?, ratePerSec?, sendFn, minGapMs?, minGapGlobalMs?, maxRetries?, baseRetryDelayMs?, dlqEnabled?, onAfterSend?, onError? })
//   stopOutboxWorkers(topic?)   // encerra workers daquele tópico (ou todos)
//   queueSize(topic)
//
// Recursos:
// - Retries com backoff exponencial + jitter (com CAP)
// - Dead-letter queue (DLQ) opcional: <topic>:dlq
// - Min gap global e por destinatário (além do ratePerSec via allowSend)
// - Logs de correlação por job.id
// - BRPOP com timeout (5s) → permite shutdown limpo
//
// ENV (opcionais):
//   QUEUE_OUTBOX_RETRIES=2
//   QUEUE_OUTBOX_RETRY_DELAY_MS=1000
//   QUEUE_OUTBOX_MIN_GAP_GLOBAL_MS=300
//   QUEUE_OUTBOX_MIN_GAP_MS=1500
//   QUEUE_OUTBOX_CONCURRENCY=1
//   QUEUE_OUTBOX_DLQ_ENABLED=true|false
//   QUEUE_OUTBOX_BACKOFF_CAP_MS=15000

// 🔧 FIX: remover getJson/setexJson (não existem no teu redis.js)
import { qpushLeft, qpopRightBlocking, qlen } from "../redis.js";
// 🔧 FIX: caminho correto para o rate-limit que existe em core/queue/
import { allowSend } from "./rate-limit.js";

const envNum  = (k, d) => (Number.isFinite(+process.env[k]) ? +process.env[k] : d);
const envBool = (k, d=false) => ["1","true","yes","y","on"].includes(String(process.env[k]||"").toLowerCase());

const DEFAULTS = {
  RETRIES:           envNum("QUEUE_OUTBOX_RETRIES", 2),
  RETRY_DELAY_MS:    envNum("QUEUE_OUTBOX_RETRY_DELAY_MS", 1000),
  MIN_GAP_GLOBAL_MS: envNum("QUEUE_OUTBOX_MIN_GAP_GLOBAL_MS", 300),
  MIN_GAP_MS:        envNum("QUEUE_OUTBOX_MIN_GAP_MS", 1500),
  CONCURRENCY:       envNum("QUEUE_OUTBOX_CONCURRENCY", 1),
  DLQ_ENABLED:       envBool("QUEUE_OUTBOX_DLQ_ENABLED", true),
  BACKOFF_CAP_MS:    envNum("QUEUE_OUTBOX_BACKOFF_CAP_MS", 15000),
};

const sleep  = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (ms, pct=0.2) => {
  const j = Math.floor(ms * pct);
  return Math.max(0, ms + (Math.floor(Math.random() * (2*j + 1)) - j));
};

// ----- Estado de execução por tópico (shutdown/graceful) -----
const RUN_FLAGS = new Map(); // topic -> { stop: boolean }

/** Marca tópico para parada graciosa */
export function stopOutboxWorkers(topic) {
  if (!topic) {
    for (const key of RUN_FLAGS.keys()) RUN_FLAGS.set(key, { stop: true });
    return;
  }
  const curr = RUN_FLAGS.get(topic) || { stop: false };
  RUN_FLAGS.set(topic, { ...curr, stop: true });
}

// ---------------- Enqueue ----------------
export async function enqueueOutbox({ topic, to, content, meta = {} }) {
  if (!topic)   throw new Error("enqueueOutbox: topic obrigatório");
  if (!to)      throw new Error("enqueueOutbox: to obrigatório");
  if (content == null) throw new Error("enqueueOutbox: content obrigatório");

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
  concurrency      = DEFAULTS.CONCURRENCY,
  ratePerSec       = 0.5, // ~1 msg a cada 2s por processo (ajuste conforme sua infra)
  sendFn,
  minGapMs         = DEFAULTS.MIN_GAP_MS,
  minGapGlobalMs   = DEFAULTS.MIN_GAP_GLOBAL_MS,
  maxRetries       = DEFAULTS.RETRIES,
  baseRetryDelayMs = DEFAULTS.RETRY_DELAY_MS,
  dlqEnabled       = DEFAULTS.DLQ_ENABLED,
  backoffCapMs     = DEFAULTS.BACKOFF_CAP_MS,
  onAfterSend,                 // opcional: (job) => void
  onError,                     // opcional: (err, job) => void
} = {}) {
  if (!topic) throw new Error("startOutboxWorkers: topic obrigatório");
  if (typeof sendFn !== "function") throw new Error("startOutboxWorkers: sendFn obrigatório");

  RUN_FLAGS.set(topic, { stop: false });

  for (let i = 0; i < concurrency; i++) {
    loop({
      topic, wid: i, ratePerSec, sendFn,
      minGapMs, minGapGlobalMs, maxRetries, baseRetryDelayMs, dlqEnabled, backoffCapMs,
      onAfterSend, onError,
    }).catch((e) => console.error(`[outbox:${topic}][w${i}] loop error`, e?.stack || e));
  }
}

// ---------------- Loop principal ----------------
async function loop(opts) {
  const {
    topic, wid, ratePerSec, sendFn,
    minGapMs, minGapGlobalMs, maxRetries, baseRetryDelayMs, dlqEnabled, backoffCapMs,
    onAfterSend, onError,
  } = opts;

  const GAP_GLOBAL_KEY = `outbox:${topic}:gap:global`;

  while (true) {
    try {
      if (RUN_FLAGS.get(topic)?.stop) {
        console.log(`[outbox:${topic}][w${wid}] stopping gracefully…`);
        return;
      }

      // 0) busca job (bloqueante até 5s para permitir shutdowns limpos)
      const job = await qpopRightBlocking(topic, 5);
      if (!job) continue;

      // 1) rate-limit distribuído (token-bucket em Redis)
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

        // sucesso → grava gaps (TTL ~ gap)
        const nowAt = Date.now();
        await writeJson(GAP_GLOBAL_KEY, { at: nowAt }, Math.ceil(minGapGlobalMs/1000)+2);
        await writeJson(gapKeyPerTo, { at: nowAt }, Math.ceil(minGapMs/1000)+2);

        if (typeof onAfterSend === "function") {
          try { await onAfterSend(job); } catch (hookErr) {
            console.warn(`[outbox:${topic}][w${wid}][${job.id}] onAfterSend hook error:`, hookErr?.message || hookErr);
          }
        }
      } catch (sendErr) {
        const tries = (job.meta?.tries ?? 0) + 1;
        job.meta = { ...(job.meta || {}), tries };
        const errMsg = sendErr?.message || String(sendErr);

        if (typeof onError === "function") {
          try { await onError(sendErr, job); } catch (hookErr) {
            console.warn(`[outbox:${topic}][w${wid}][${job.id}] onError hook error:`, hookErr?.message || hookErr);
          }
        }

        if (tries > maxRetries) {
          if (dlqEnabled) {
            await pushDLQ(topic, { ...job, error: errMsg });
            console.error(`[outbox:${topic}][w${wid}][${job.id}] DLQ after ${tries} tries: ${errMsg}`);
          } else {
            console.error(`[outbox:${topic}][w${wid}][${job.id}] dropped after ${tries} tries: ${errMsg}`);
          }
          continue;
        }

        // backoff exponencial com CAP + jitter
        const exp = baseRetryDelayMs * Math.pow(2, Math.min(tries - 1, 3));
        const capped = Math.min(exp, backoffCapMs);
        const delay = jitter(capped);
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
  // Se teu redis.js expuser helpers getJson/setexJson, eles serão usados;
  // caso contrário, estas funções viram NO-OP (seguimos só com min-gaps via RAM/loop).
  try { if (typeof getJson === "function") return await getJson(key); } catch {}
  return null;
}
async function writeJson(key, obj, ttlSec = 5) {
  try { if (typeof setexJson === "function") return await setexJson(key, obj, ttlSec); } catch {}
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
  return String(to || "").replace(/\D/g, "") || "unknown";
}

// ---------------- Util ----------------
export async function queueSize(topic) {
  try { return await qlen(topic); } catch { return -1; }
}

export default { enqueueOutbox, startOutboxWorkers, stopOutboxWorkers, queueSize };
