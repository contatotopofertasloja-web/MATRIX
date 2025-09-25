// configs/bots/claudia/hooks/index.js
import greet from '../flow/greet.js';
import { gate, recall, remember } from '../flow/_state.js';

export default async function openingHook(ctx = {}) {
  const { state = {}, settings = {}, jid, messageId } = ctx;

  // 0) idempotência por mensagem (se o core disponibiliza messageId)
  if (messageId) {
    if (state.__last_msg_id === messageId) {
      if (settings?.flags?.debug_log_router) console.log('[HOOK] drop duplicate messageId');
      return { reply: null, next: undefined };
    }
    state.__last_msg_id = messageId;
  }

  // 1) idempotência persistente (Redis): só dispara 1x por contato
  const mem = await recall(jid);
  if (mem?.__hook_fired === true || state.__boot_greet_done) {
    if (settings?.flags?.debug_log_router) console.log('[HOOK] already fired, skip');
    return { reply: null, next: 'qualificacao' };
  }

  // 2) trava anti-rajada local (8s) — defesa adicional
  if (gate(state, 'hook_opening', 8000)) {
    if (settings?.flags?.debug_log_router) console.log('[HOOK] gate hook_opening drop');
    return { reply: null, next: 'greet' };
  }

  // 3) marca como disparado (persistente) e delega pro greet
  await remember(jid, { __hook_fired: true });
  return await greet(ctx);
}
