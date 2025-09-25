// configs/bots/claudia/hooks/index.js
// Hook de abertura SILENCIOSO. Não envia mensagem.
// Proteções: Kill-switch em settings, lock atômico no Redis (SET NX PX),
// flag persistente __hook_fired e gate local anti-rajada.

import { gate, recall, remember } from "../flow/_state.js";
import Redis from "ioredis";

const REDIS_URL = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || "";
const BOT_ID = process.env.BOT_ID || "claudia";
const MSG_DEDUPE_WINDOW_MS = Number(process.env.MSG_DEDUPE_MS || 600_000); // 10 min
const HOOK_LOCK_MS = Number(process.env.HOOK_LOCK_MS || 30_000); // 30s

let redis = null;
try {
  if (REDIS_URL) {
    redis = new Redis(REDIS_URL);
    redis.on("error", (e) => console.warn("[HOOK] redis error:", e?.message || e));
  }
} catch { redis = null; }

const lockKey = (jid) => `mx:hooklock:v1:${BOT_ID}:${jid}`;

export default async function openingHook(ctx = {}) {
  const { state = {}, settings = {}, jid, messageId } = ctx;

  // 0) Kill-switch: se desligado em settings, não faz nada
  if (settings?.flags?.disable_opening_hook === true) {
    return { reply: null, next: undefined };
  }

  // 1) Dedupe por messageId (retries do WhatsApp)
  if (messageId) {
    const now = Date.now();
    const seen = state.__msg_seen || {};
    if (seen[messageId] && (now - seen[messageId]) < MSG_DEDUPE_WINDOW_MS) {
      return { reply: null, next: undefined };
    }
    for (const [mid, ts] of Object.entries(seen)) {
      if (now - ts > MSG_DEDUPE_WINDOW_MS) delete seen[mid];
    }
    seen[messageId] = now;
    state.__msg_seen = seen;
  }

  // 2) Se já marcamos este contato, não fazemos nada
  const mem = await recall(jid);
  if (mem?.__hook_fired === true || state.__hook_fired === true) {
    return { reply: null, next: undefined };
  }

  // 3) Lock atômico no Redis (evita execuções concorrentes)
  if (redis) {
    try {
      const res = await redis.set(lockKey(jid), "1", "PX", HOOK_LOCK_MS, "NX");
      if (res !== "OK") return { reply: null, next: undefined };
    } catch (e) {
      console.warn("[HOOK] lock set failed:", e?.message || e);
    }
  }

  // 4) Gate local anti-rajada
  if (gate(state, "hook_opening", 8000)) {
    return { reply: null, next: undefined };
  }

  // 5) Marca disparo (persistente + local) — SEM falar nada
  state.__hook_fired = true;
  try { await remember(jid, { __hook_fired: true }); } catch {}

  // Sem reply: o flow/index.js detecta primeiro turno e faz greet 1x
  return { reply: null, next: undefined };
}
