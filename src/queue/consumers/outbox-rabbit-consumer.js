// node src/queue/consumers/outbox-rabbit-consumer.js
import 'dotenv/config'
import { adapter } from '../../index-gpt.js'
import amqplib from 'amqplib'

const OUTBOX_TOPIC = process.env.QUEUE_OUTBOX_TOPIC || 'matrix.outbox'
const OUTBOX_MIN_GAP_USER_MS   = Number(process.env.QUEUE_OUTBOX_MIN_GAP_MS || 1200)
const OUTBOX_MIN_GAP_GLOBAL_MS = Number(process.env.QUEUE_OUTBOX_MIN_GAP_GLOBAL_MS || 300)
const RETRIES                  = Number(process.env.QUEUE_OUTBOX_RETRIES || 2)
const RETRY_DELAY_MS           = Number(process.env.QUEUE_OUTBOX_RETRY_DELAY_MS || 1000)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const lastByUser = new Map()

async function enforceGap(to) {
  const last = lastByUser.get(to) || 0
  const now = Date.now()
  const wait = last + OUTBOX_MIN_GAP_USER_MS - now
  if (wait > 0) await sleep(wait)
}
async function sendWithRetry(to, text) {
  let a = 0
  while (true) {
    try {
      await enforceGap(to)
      await adapter.sendMessage(to, text)
      lastByUser.set(to, Date.now())
      await sleep(OUTBOX_MIN_GAP_GLOBAL_MS)
      return
    } catch (e) {
      if (++a > RETRIES) throw e
      await sleep(RETRY_DELAY_MS * a)
    }
  }
}

async function main() {
  const conn = await amqplib.connect(process.env.AMQP_URL || 'amqp://localhost')
  const ch = await conn.createChannel()
  await ch.assertQueue(OUTBOX_TOPIC, { durable: true })
  ch.prefetch(Number(process.env.RABBIT_PREFETCH || 8))
  console.log('[RABBIT][CONSUMER] ON')
  ch.consume(OUTBOX_TOPIC, async msg => {
    if (!msg) return
    try {
      const body = JSON.parse(msg.content.toString('utf-8') || '{}')
      await sendWithRetry(body.to, body.text)
      ch.ack(msg)
    } catch (e) {
      console.error('[RABBIT][CONSUMER][ERR]', e?.message || e)
      ch.nack(msg, false, true)
    }
  })
}
main().catch(console.error)
