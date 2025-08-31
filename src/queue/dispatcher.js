// src/core/queue/dispatcher.js
// Backend de fila selecionável por ENV (padrão: redis)
const BACKEND = (process.env.QUEUE_BACKEND || 'redis').toLowerCase(); // memory | rabbit | sqs | redis | none

/**
 * Enfileira uma saída (resposta) no tópico/stream informado.
 * topic: nome do stream/fila (ex.: outbox:claudia-main)
 * to/text/meta: payload da mensagem
 */
export async function enqueueOutbox({ topic, to, text, meta }) {
  switch (BACKEND) {
    case 'redis': {
      const { enqueueOutboxRedis } = await import('./redis-backend.js');
      return enqueueOutboxRedis({ key: topic, to, text, meta });
    }
    // Se quiser reativar outros backends, acrescente aqui:
    // case 'memory': { const { enqueueOutboxMemory } = await import('./memory-backend.js'); ... }
    // case 'rabbit': { const { enqueueOutboxRabbit } = await import('./rabbit-backend.js'); ... }
    // case 'sqs':    { const { enqueueOutboxSQS }    = await import('./sqs-backend.js'); ... }
    default:
      throw new Error(`QUEUE_BACKEND="${BACKEND}" não suportado neste build`);
  }
}

/**
 * Sobe os workers consumidores para o tópico informado.
 * concurrency: quantos consumidores paralelos para o mesmo stream
 * sendFn: função que envia de fato (ex.: adapter.sendMessage)
 */
export async function startOutboxWorkers({ topic, concurrency = 1, sendFn }) {
  switch (BACKEND) {
    case 'redis': {
      const { startOutboxWorkersRedis } = await import('./redis-backend.js');
      const perMin = Number(process.env.WPP_RATE_LIMIT_PER_MIN || 25);
      for (let i = 0; i < concurrency; i++) {
        startOutboxWorkersRedis({
          key: topic,
          group: process.env.OUTBOX_GROUP || 'g1',
          consumer: `c-${i}-${Math.random().toString(36).slice(2,7)}`,
          perMin,
          sendFn,
        }).catch(e => console.error('[outbox-redis] worker failed', e?.message || e));
      }
      return;
    }
    // Reative aqui se usar outros backends:
    // case 'memory': ...
    // case 'rabbit': ...
    // case 'sqs': ...
    default:
      throw new Error(`QUEUE_BACKEND="${BACKEND}" não suportado neste build`);
  }
}
