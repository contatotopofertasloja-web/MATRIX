// src/core/queue/dispatcher.js
import { qpushLeft, qpopRightBlocking } from './redis.js';
import { allowSend } from './rate-limit.js';

export async function enqueueOutbox({ topic, to, content, meta = {} }) {
  if (!topic) throw new Error('enqueueOutbox: topic obrigatório');
  if (!to) throw new Error('enqueueOutbox: to obrigatório');
  if (!content) throw new Error('enqueueOutbox: content obrigatório');

  const job = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    to,
    content,
    meta,
  };
  await qpushLeft(topic, job);
  return { ok: true, enqueued: true, topic, id: job.id };
}

export async function startOutboxWorkers({ topic, concurrency = 1, ratePerSec = 0.5, sendFn }) {
  if (!topic) throw new Error('startOutboxWorkers: topic obrigatório');
  if (typeof sendFn !== 'function') throw new Error('startOutboxWorkers: sendFn obrigatório');

  for (let i = 0; i < concurrency; i++) {
    loop(topic, ratePerSec, sendFn).catch((e) =>
      console.error(`[outbox:${topic}][w${i}] loop error`, e)
    );
  }
}

async function loop(topic, ratePerSec, sendFn) {
  // loop infinito controlado por BRPOP timeout
  while (true) {
    try {
      const job = await qpopRightBlocking(topic, 5);
      if (!job) continue;

      // rate-limit distribuído
      const can = await allowSend({ topic, ratePerSec });
      if (!can) {
        // devolve pro início da fila (reprocessar mais tarde)
        await qpushLeft(topic, job);
        await sleep(1000); // backoff mínimo
        continue;
      }

      // envia
      await sendFn(job.to, job.content);
    } catch (e) {
      console.error(`[outbox:${topic}] send error`, e?.message || e);
      await sleep(500);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
