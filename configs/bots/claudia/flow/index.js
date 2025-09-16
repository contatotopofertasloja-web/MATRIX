// configs/bots/claudia/flow/index.js
// Runner do flow da Cláudia: garante state, escolhe o fluxo via router e executa.
// Inclui logs opcionais controlados por settings.flags.debug_log_router.

import greet from './greet.js';
import qualify from './qualify.js';
import offer from './offer.js';
import objections from './objections.js';
import close from './close.js';
import postsale from './postsale.js';
import faq from './faq.js';
import { pickFlow } from './router.js';
import { initialState } from './_state.js';

export const registry = { greet, qualify, offer, objections, close, postsale, faq };

function shouldLog(settings) {
  return process.env.NODE_ENV !== 'production' || settings?.flags?.debug_log_router === true;
}
function log(settings, ...a) {
  if (shouldLog(settings)) console.log('[CLAUDIA_ROUTER]', ...a);
}

export async function handle(ctx = {}) {
  // Garante que o mesmo objeto de state é reaproveitado pelo core entre mensagens.
  ctx.state = ctx.state || {};
  const base = initialState();
  for (const k of Object.keys(base)) if (ctx.state[k] === undefined) ctx.state[k] = base[k];

  const text = ctx?.text || '';
  const settings = ctx?.settings || {};

  const Flow = pickFlow(text, settings, ctx.state);
  log(settings, 'PICK:', Flow?.name, '| text=', text);

  const out = await Flow(ctx);

  // Log resumido da saída (ajuda a depurar roteamento)
  const preview = (out?.reply || '').toString().slice(0, 140).replace(/\s+/g, ' ');
  log(settings, 'OUT:', { next: out?.next, preview });

  return out;
}

export default { registry, handle };
