// src/core/queue/redis-backend.js
import { redis } from '../redis.js';

const DEFAULT_LIMIT_PER_MIN = Number(process.env.WPP_RATE_LIMIT_PER_MIN || 25);

/**
 * Publica item no stream Redis (XADD).
 * text pode ser string OU objeto (ex.: { type: 'image', imageUrl, caption })
 */
export async function enqueueOutboxRedis({ key, to, text, meta = {} }) {
  if (!key) throw new Error('enqueueOutboxRedis: missing key');
  if (!to || text == null) return null; // aceita objeto ou string
  const payload = JSON.stringify({ to, text, meta, ts: Date.now() });
  return redis.xadd(key, '*', 'msg', payload);
}

/**
 * Sobe um ou mais consumidores (XREADGROUP) no mesmo grupo.
 * O sendFn deve aceitar (to, content) onde content = string OU objeto.
 */
export async function startOutboxWorkersRedis({
  key,
  group = 'g1',
  consumer = `c-${Math.random().toString(36).slice(2, 7)}`,
  perMin = DEFAULT_LIMIT_PER_MIN,
  sendFn,
}) {
  if (!key) throw new Error('startOutboxWorkersRedis: missing key');
  if (typeof sendFn !== 'function') throw new Error('startOutboxWorkersRedis: sendFn required');

  await ensureGroup(key, group);
  console.log(`[outbox-redis] up key=${key} group=${group} consumer=${consumer} limit=${perMin}/min`);

  while (true) {
    try {
      const res = await redis.xreadgroup(
        'GROUP', group, consumer,
        'BLOCK', 5000,
        'COUNT', 10,
        'STREAMS', key, '>'
      );
      if (!res) continue;

      for (const [, entries] of res) {
        for (const [id, fields] of entries) {
          try {
            const data = parseXFields(fields);
            const parsed = JSON.parse(data.msg || '{}'); // { to, text, meta, ts }
            const to = parsed?.to;
            const content = parsed?.text; // string OU objeto

            if (!to || content == null) {
              // payload inválido → ACK e descarta
              await redis.xack(key, group, id);
              await redis.xdel(key, id);
              continue;
            }

            await enforcePerMinuteLimit(to, perMin);

            // entrega para o adapter/serviço que decide se é texto ou imagem
            await sendFn(to, content);

            await redis.xack(key, group, id);
            await redis.xdel(key, id);
          } catch (eItem) {
            console.error('[outbox-redis][item]', eItem?.message || eItem);
            // sem ACK → volta para a fila (reprocessa depois)
            // opcional: implementar DLQ aqui se quiser
          }
        }
      }
    } catch (eLoop) {
      console.error('[outbox-redis][loop]', eLoop?.message || eLoop);
      await sleep(1000);
    }
  }
}

async function ensureGroup(key, group) {
  try {
    await redis.xgroup('CREATE', key, group, '0', 'MKSTREAM');
  } catch (e) {
    if (!String(e?.message || '').includes('BUSYGROUP')) throw e;
  }
}

function parseXFields(fields) {
  const obj = {};
  for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
  return obj;
}

/**
 * Rate-limit por destinatário (jid/min).
 * Se estourar, espera 1s e tenta de novo (fila "respira").
 */
async function enforcePerMinuteLimit(jid, perMin) {
  const minute = Math.floor(Date.now() / 60000);
  const key = `rl:${jid}:${minute}`;
  const cnt = await redis.incr(key);
  if (cnt === 1) await redis.expire(key, 70); // ~1 min + buffer

  if (cnt > perMin) {
    await sleep(1000);
    return enforcePerMinuteLimit(jid, perMin);
  }
  return true;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
