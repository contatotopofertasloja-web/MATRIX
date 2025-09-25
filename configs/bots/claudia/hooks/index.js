// configs/bots/claudia/hooks/index.js
// Hook de abertura SILENCIOSO (idempotente). Não envia texto nenhum.
// Apenas arma o bootstrap e deixa o flow/index.js fazer o greet 1x.
// Proteções:
//  - Dedupe por messageId (10min) quando disponível
//  - Flag persistente __hook_fired em Redis (via recall/remember)
//  - Gate local anti-rajada

import { gate, recall, remember } from "../flow/_state.js";

// janela de dedupe por messageId (retries do WhatsApp)
const MSG_DEDUPE_WINDOW_MS = Number(process.env.MSG_DEDUPE_MS || 600_000); // 10min

export default async function openingHook(ctx = {}) {
  const { state = {}, settings = {}, jid, messageId } = ctx;

  // 0) Dedupe por messageId (se o core fornece)
  if (messageId) {
    const now = Date.now();
    const seen = state.__msg_seen || {};
    if (seen[messageId] && (now - seen[messageId]) < MSG_DEDUPE_WINDOW_MS) {
      if (settings?.flags?.debug_log_router) console.log("[HOOK] drop duplicate messageId");
      return { reply: null, next: undefined };
    }
    // limpeza simples + marca atual
    for (const [mid, ts] of Object.entries(seen)) {
      if (now - ts > MSG_DEDUPE_WINDOW_MS) delete seen[mid];
    }
    seen[messageId] = now;
    state.__msg_seen = seen;
  }

  // 1) Idempotência PERSISTENTE (por contato): só arma 1x
  const mem = await recall(jid);
  if (mem?.__hook_fired === true || state.__hook_fired === true) {
    // Não responde — deixa o flow seguir normalmente
    return { reply: null, next: undefined };
  }

  // 2) Gate local anti-rajada
  if (gate(state, "hook_opening", 8000)) {
    if (settings?.flags?.debug_log_router) console.log("[HOOK] gate hook_opening drop");
    return { reply: null, next: undefined };
  }

  // 3) Marca como disparado (persistente + local) e NÃO fala nada
  state.__hook_fired = true;
  await remember(jid, { __hook_fired: true });

  // Devolve sem reply: o flow/index.js detecta first-turn e faz greet 1x
  return { reply: null, next: undefined };
}
