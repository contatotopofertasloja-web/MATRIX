// src/queue/dispatcher.js
// Versão “irmã” fora do core, mantendo a mesma API.
// Importa ./redis.js (ao lado) e ./rate-limit.js deste diretório.

import { qpushLeft, qpopRightBlocking } from './redis.js';
import { allowSend } from './rate-limit.js';

export async function enqueueOutbox({ topic, to, content, meta = {} }) {
  if (!topic) throw new Error('enqueueOutbox: topic obrigatório');
  if (!to) throw new Error('enqueueOutbox: to obrigatório');
  if (content == null) throw new Error('enqueueOutbox: content obrigatório');

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
    loop(topic, ratePerSec, sendFn, i).catch((e) =>
      console.error(`[outbox:${topic}][w${i}] loop error`, e?.message || e)
    );
  }
}

async function loop(topic, ratePerSec, sendFn, wid = 0) {
  while (true) {
    try {
      const job = await qpopRightBlocking(topic, 5);
      if (!job) continue;

      const can = await allowSend({ topic, ratePerSec });
      if (!can) {
        await qpushLeft(topic, job);
        await sleep(1000);
        continue;
      }

      await sendFn(job.to, job.content);
    } catch (e) {
      console.error(`[outbox:${topic}][w${wid}] send error`, e?.message || e);
      await sleep(500);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
