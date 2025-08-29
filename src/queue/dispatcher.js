// src/queue/dispatcher.js
import { adapter } from '../index-gpt.js'

// ====== CONFIG
const BACKEND = (process.env.QUEUE_BACKEND || 'memory').toLowerCase()
const OUTBOX_TOPIC = process.env.QUEUE_OUTBOX_TOPIC || 'matrix.outbox'
const SERVICE_ID = process.env.SERVICE_ID || `svc-${Math.random().toString(36).slice(2,8)}`

// Common controls (mesmo para memory e consumidores dos brokers)
const OUTBOX_MIN_GAP_USER_MS   = Number(process.env.QUEUE_OUTBOX_MIN_GAP_MS || 1200)
const OUTBOX_MIN_GAP_GLOBAL_MS = Number(process.env.QUEUE_OUTBOX_MIN_GAP_GLOBAL_MS || 300)
const OUTBOX_CONCURRENCY       = Number(process.env.QUEUE_OUTBOX_CONCURRENCY || 4)
const RETRIES                  = Number(process.env.QUEUE_OUTBOX_RETRIES || 2)
const RETRY_DELAY_MS           = Number(process.env.QUEUE_OUTBOX_RETRY_DELAY_MS || 1000)

// ====== Helpers
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ====== Memory backend (fallback rápido)
const memQ = []
const memWorkers = []
const lastSendAtByUser = new Map()

async function enforcePerUserGap(to) {
  const last = lastSendAtByUser.get(to) || 0
  const now = Date.now()
  const wait = last + OUTBOX_MIN_GAP_USER_MS - now
  if (wait > 0) await sleep(wait)
}

async function sendWithRetry(to, text) {
  let attempt = 0
  while (true) {
    try {
      await enforcePerUserGap(to)
      await adapter.sendMessage(to, text)
      lastSendAtByUser.set(to, Date.now())
      await sleep(OUTBOX_MIN_GAP_GLOBAL_MS)
      return
    } catch (e) {
      attempt++
      if (attempt > RETRIES) throw e
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }
}

async function memWorkerLoop() {
  while (true) {
    const job = memQ.shift()
    if (!job) { await sleep(50); continue }
    const { to, text, resolve, reject } = job
    try { await sendWithRetry(to, text); resolve() }
    catch (e) { reject(e) }
  }
}

function startMemory() {
  if (memWorkers.length) return
  for (let i = 0; i < OUTBOX_CONCURRENCY; i++) memWorkers.push(memWorkerLoop())
  console.log(`[QUEUE][OUTBOX][memory] ON workers=${OUTBOX_CONCURRENCY} gapUser=${OUTBOX_MIN_GAP_USER_MS}ms`)
}

function enqueueMemory(to, text) {
  return new Promise((resolve, reject) => memQ.push({ to, text: String(text), resolve, reject }))
}

// ====== Redis (BullMQ)
let bull = null, bullQueue = null, bullWorker = null
async function startRedis() {
  const { Queue, Worker, QueueScheduler } = await import('bullmq')
  const connection = { url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' }
  bullQueue = new Queue(OUTBOX_TOPIC, { connection })
  // Scheduler evita stucks
  // eslint-disable-next-line no-unused-vars
  const _scheduler = new QueueScheduler(OUTBOX_TOPIC, { connection })

  bullWorker = new Worker(
    OUTBOX_TOPIC,
    async (job) => {
      const { to, text } = job.data
      await sendWithRetry(to, text) // mantém gaps e retry aqui
    },
    { connection, concurrency: OUTBOX_CONCURRENCY }
  )
  bullWorker.on('ready', () => console.log(`[QUEUE][OUTBOX][redis] ON workers=${OUTBOX_CONCURRENCY}`))
  bullWorker.on('failed', (job, err) => console.warn('[QUEUE][OUTBOX][redis] FAIL', job?.id, err?.message))
}
async function enqueueRedis(to, text) {
  return bullQueue.add('send', { to, text }, { attempts: RETRIES + 1, backoff: { type: 'exponential', delay: RETRY_DELAY_MS } })
}

// ====== SQS
let sqsClient = null
async function startSqs() {
  const { SQSClient } = await import('@aws-sdk/client-sqs')
  sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' })
  console.log('[QUEUE][OUTBOX][sqs] ON (producer). Lembre: subir um CONSUMER separado.')
}
async function enqueueSqs(to, text) {
  const { SendMessageCommand } = await import('@aws-sdk/client-sqs')
  const QueueUrl = process.env.SQS_OUTBOX_URL
  if (!QueueUrl) throw new Error('SQS_OUTBOX_URL não definido')
  const MessageBody = JSON.stringify({ to, text, svc: SERVICE_ID })
  await sqsClient.send(new SendMessageCommand({ QueueUrl, MessageBody }))
}

// ====== RabbitMQ
let amqp = null, amqpConn = null, amqpCh = null
async function startRabbit() {
  amqp = await import('amqplib')
  amqpConn = await amqp.connect(process.env.AMQP_URL || 'amqp://localhost')
  amqpCh = await amqpConn.createChannel()
  await amqpCh.assertQueue(OUTBOX_TOPIC, { durable: true })
  console.log('[QUEUE][OUTBOX][rabbit] ON (producer). Lembre: subir um CONSUMER separado.')
}
async function enqueueRabbit(to, text) {
  const buf = Buffer.from(JSON.stringify({ to, text, svc: SERVICE_ID }))
  amqpCh.sendToQueue(OUTBOX_TOPIC, buf, { persistent: true })
}

// ====== API pública
export async function startQueues() {
  switch (BACKEND) {
    case 'redis':
      await startRedis(); break
    case 'sqs':
      await startSqs(); break
    case 'rabbit':
      await startRabbit(); break
    default:
      startMemory(); break
  }
}

export async function dispatchMessage(to, text) {
  switch (BACKEND) {
    case 'redis':  return enqueueRedis(to, text)
    case 'sqs':    return enqueueSqs(to, text)
    case 'rabbit': return enqueueRabbit(to, text)
    default:       return enqueueMemory(to, text)
  }
}
