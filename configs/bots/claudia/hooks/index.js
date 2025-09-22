// configs/bots/claudia/hooks/index.js
// Hook de abertura idempotente: NÃO fala por conta própria.
// Apenas redireciona para o greet, com trava anti-rajada.

import greet from '../flow/greet.js';
import { gate } from '../flow/_state.js';

export default async function openingHook(ctx = {}) {
  const { state, settings } = ctx;

  // Se já abrimos o greet, não faça nada.
  if (state?.__boot_greet_done) return { reply: null, next: 'qualificacao' };

  // Trava anti-rajada no nível do hook (5s)
  if (gate(state, 'hook_opening', 5000)) {
    if (settings?.flags?.debug_log_router) console.log('[HOOK] gate hook_opening drop');
    return { reply: null, next: 'greet' };
  }

  // Delegar para o greet (que enviará foto 1x se necessário)
  return await greet(ctx);
}
