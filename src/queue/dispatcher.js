// src/queue/dispatcher.js — wrapper HTTP/outbox
import express from "express";
import { enqueueOutbox, startOutboxWorkers, queueSize } from "../core/queue/dispatcher.js";
import { adapter as wpp } from "../adapters/whatsapp/index.js";

const OUTBOX_TOPIC           = process.env.OUTBOX_TOPIC || "outbox:whatsapp";
const OUTBOX_RATE_PER_SEC    = Number(process.env.OUTBOX_RATE_PER_SEC || 0.5);
const OUTBOX_CONCURRENCY     = Number(process.env.OUTBOX_CONCURRENCY || 1);
const OUTBOX_MIN_GAP_MS      = Number(process.env.OUTBOX_MIN_GAP_MS || 1500);
const OUTBOX_MIN_GAP_GLOBAL  = Number(process.env.OUTBOX_MIN_GAP_GLOBAL_MS || 300);
const OUTBOX_RETRIES         = Number(process.env.OUTBOX_RETRIES || 2);
const OUTBOX_RETRY_DELAY_MS  = Number(process.env.OUTBOX_RETRY_DELAY_MS || 1000);
const OUTBOX_DLQ_ENABLED     = String(process.env.OUTBOX_DLQ_ENABLED || "true").toLowerCase() === "true";

// --- helper para enviar UMA unidade de conteúdo ---
async function sendUnit(jid, unit) {
  if (unit && typeof unit === "object" && unit.imageUrl) {
    const { imageUrl, caption = "", allowLink = false, allowPrice = false } = unit;
    console.log(`[outbox/send] image to=${jid} caption=${caption.slice(0,40)}`);
    await wpp.sendImage(jid, imageUrl, caption, { allowLink, allowPrice });
    return;
  }
  const text = typeof unit === "string" ? unit : String(unit?.text ?? "");
  const allowLink  = !!unit?.allowLink;
  const allowPrice = !!unit?.allowPrice;
  console.log(`[outbox/send] text to=${jid} preview=${text.slice(0,60)}`);
  await wpp.sendMessage(jid, { text, allowLink, allowPrice });
}

async function sendFn(jid, content) {
  try {
    // Suporte a múltiplas mensagens (replies[])
    if (Array.isArray(content)) {
      for (const unit of content) {
        // envia cada parte em sequência, respeitando o rate/worker
        await sendUnit(jid, unit);
      }
      return;
    }
    // Mensagem única (com ou sem imagem)
    await sendUnit(jid, content);
  } catch (e) {
    console.warn("[outbox/send] erro:", e?.message || e);
    throw e;
  }
}

export async function enqueueText(to, text, meta = {}) {
  return enqueueOutbox({ topic: OUTBOX_TOPIC, to, content: String(text || ""), meta });
}
export async function enqueuePayload(to, payload, meta = {}) {
  // payload pode ser string, objeto, ou ARRAY de objetos/strings (replies)
  return enqueueOutbox({ topic: OUTBOX_TOPIC, to, content: payload, meta });
}

export async function start() {
  await startOutboxWorkers({
    topic: OUTBOX_TOPIC,
    concurrency: OUTBOX_CONCURRENCY,
    ratePerSec: OUTBOX_RATE_PER_SEC,
    sendFn,
    minGapMs: OUTBOX_MIN_GAP_MS,
    minGapGlobalMs: OUTBOX_MIN_GAP_GLOBAL,
    maxRetries: OUTBOX_RETRIES,
    baseRetryDelayMs: OUTBOX_RETRY_DELAY_MS,
    dlqEnabled: OUTBOX_DLQ_ENABLED,
  });
  console.log(`[outbox] iniciado topic=${OUTBOX_TOPIC} conc=${OUTBOX_CONCURRENCY} rps=${OUTBOX_RATE_PER_SEC}`);
}

export async function size() { return queueSize(OUTBOX_TOPIC); }

export function mountHealthCheck(app) {
  if (!app || typeof app.get !== "function") return;
  app.get("/health/queue", async (_req, res) => {
    try {
      const qsize = await size();
      res.json({ ok: true, topic: OUTBOX_TOPIC, size: qsize });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || "queue error" });
    }
  });
}

export default { start, size, enqueueText, enqueuePayload, mountHealthCheck };
