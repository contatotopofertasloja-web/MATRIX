// configs/bots/claudia/hooks/index.js
// Hook de abertura SILENCIOSO. Não envia nenhuma mensagem.
// Proteções:
//  1) Lock atômico no Redis (SET NX PX) para evitar múltiplas execuções concorrentes.
//  2) Flag persistente __hook_fired (fallback se Redis indisponível).
//  3) Gate local anti-rajada.
//  4) Dedupe por messageId (10 min), se o core passar ctx.messageId.

import { gate, recall, remember } from "../flow/_state.js";
import Redis from "ioredis";

const REDIS_URL = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || "";
const BOT_ID = process.env.BOT_ID || "claudia";
const MSG_DEDUPE_WINDOW_MS = Number(process.env.MSG_DEDUPE_MS || 600_000); // 10 min
const HOOK_LOCK_MS = Number(process.env.HOOK_LOCK_MS || 30_000); // 30s de lock por contato

let redis = null;
try {
  if (REDIS_URL) {
    redis = new Redis(REDIS_URL);
    redis.on("error", (e) => console.warn("[HOOK] redis error:", e?.message || e));
  }
} catch { redis = null; }

function lockKey(jid) {
  return `mx:hooklock:v1:${BOT_ID}:${jid}`;
}

export default async function openingHook(ctx = {}) {
  const { state = {}, settings = {}, jid, messageId } = ctx;

  // 0) dedupe por messageId (retries do WhatsApp)
  if (messageId) {
    const now = Date.now();
    const seen = state.__msg_seen || {};
    if (seen[messageId] && (now - seen[messageId]) < MSG_DEDUPE_WINDOW_MS) {
      if (settings?.flags?.debug_log_router) console.log("[HOOK] drop duplicate messageId");
      return { reply: null, next: undefined };
    }
    // limpa antigos
    for (const [mid, ts] of Object.entries(seen)) {
      if (now - ts > MSG_DEDUPE_WINDOW_MS) delete seen[mid];
    }
    seen[messageId] = now;
    state.__msg_seen = seen;
  }

  // 1) se já marcamos este contato, não fazemos nada
  const mem = await recall(jid);
  if (mem?.__hook_fired === true || state.__hook_fired === true) {
    return { reply: null, next: undefined };
  }

  // 2) lock atômico no Redis para evitar múltiplas execuções concorrentes
  if (redis) {
    try {
      const res = await redis.set(lockKey(jid), "1", "PX", HOOK_LOCK_MS, "NX");
      if (res !== "OK") {
        // já tem outro hook em curso — não fala nada
        if (settings?.flags?.debug_log_router) console.log("[HOOK] lock hit, skip");
        return { reply: null, next: undefined };
      }
    } catch (e) {
      console.warn("[HOOK] lock set failed:", e?.message || e);
      // segue para as demais proteções
    }
  }

  // 3) gate local anti-rajada (segunda linha de defesa)
  if (gate(state, "hook_opening", 8000)) {
    if (settings?.flags?.debug_log_router) console.log("[HOOK] gate drop");
    return { reply: null, next: undefined };
  }

  // 4) marca como disparado (persistente + local) e NÃO envia texto
  state.__hook_fired = true;
  try { await remember(jid, { __hook_fired: true }); } catch {}

  // ⚠️ sem reply: quem fala é o flow/index.js (primeiro turno → greet 1x)
  return { reply: null, next: undefined };
}
