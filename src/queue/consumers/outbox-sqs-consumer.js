// node src/queue/consumers/outbox-sqs-consumer.js
import 'dotenv/config'
import { adapter } from '../../index-gpt.js'

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
  const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = await import('@aws-sdk/client-sqs')
  const client = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' })
  const QueueUrl = process.env.SQS_OUTBOX_URL
  if (!QueueUrl) throw new Error('SQS_OUTBOX_URL não definido')

  console.log('[SQS][CONSUMER] ON')
  while (true) {
    const { Messages } = await client.send(new ReceiveMessageCommand({
      QueueUrl,
      MaxNumberOfMessages: 5,
      WaitTimeSeconds: 10,
      VisibilityTimeout: 30
    }))
    if (!Messages?.length) continue
    for (const m of Messages) {
      try {
        const body = JSON.parse(m.Body || '{}')
        await sendWithRetry(body.to, body.text)
        await client.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: m.ReceiptHandle }))
      } catch (e) {
        console.error('[SQS][CONSUMER][ERR]', e?.message || e)
      }
    }
  }
}
main().catch(console.error)
