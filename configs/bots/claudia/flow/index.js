// configs/bots/claudia/flow/index.js
// Runner do flow da Cláudia: garante state, força boot pelo greet (1x),
// aplica TRAVA anti-rajada e roteia via pickFlow nas mensagens seguintes.

import greet from './greet.js';
import qualify from './qualify.js';
import offer from './offer.js';
import fechamento from './fechamento.js';
import postsale from './postsale.js';
import { pickFlow } from './router.js';
import { initialState, gate } from './_state.js';

export const registry = { greet, qualify, offer, fechamento, postsale };

function shouldLog(settings) {
  return process.env.NODE_ENV !== 'production' || settings?.flags?.debug_log_router === true;
}
function log(settings, ...a) { if (shouldLog(settings)) console.log('[CLAUDIA_ROUTER]', ...a); }

// Foto de abertura 1x por contato
async function ensureOpeningPhotoOnce(ctx) {
  const { settings, state, outbox, jid } = ctx || {};
  if (
    settings?.flags?.send_opening_photo &&
    settings?.media?.opening_photo_url &&
    !state.__sent_opening_photo
  ) {
    await outbox.publish({
      to: jid,
      kind: 'image',
      payload: { url: settings.media.opening_photo_url, caption: '' }
    });
    state.__sent_opening_photo = true;
  }
}

export async function handle(ctx = {}) {
  ctx.state = ctx.state || {};
  const base = initialState();
  for (const k of Object.keys(base)) if (ctx.state[k] === undefined) ctx.state[k] = base[k];

  const text = ctx?.text || '';
  const settings = ctx?.settings || {};
  ctx.state.turns = (ctx.state.turns || 0) + 1;

  // 🔒 TRAVA geral anti-rajada (qualquer saída em < 1200ms é suprimida)
  if (gate(ctx.state, '__any_out', 1200)) {
    log(settings, 'GATE: __any_out (drop burst)');
    return { reply: null, next: undefined };
  }

  // 🚀 PRIMEIRO TURNO → sempre greet (e com trava específica)
  if (!ctx.state.__boot_greet_done) {
    // evita múltiplos GREET concorrentes
    if (gate(ctx.state, 'boot_greet', 5000)) {
      log(settings, 'GATE: boot_greet (duplicate)');
      return { reply: null, next: 'greet' };
    }
    await ensureOpeningPhotoOnce(ctx);
    const outGreet = await greet(ctx);
    ctx.state.__boot_greet_done = true;

    const preview = (outGreet?.reply || '').toString().slice(0, 140).replace(/\s+/g, ' ');
    log(settings, 'BOOT:GREET', { preview, next: outGreet?.next });
    return outGreet;
  }

  // ➡️ Mensagens seguintes → roteador normal
  const Flow = pickFlow(text, settings, ctx.state) || qualify;
  log(settings, 'PICK:', Flow?.name, '| text=', text);

  const out = await Flow(ctx);
  const preview = (out?.reply || '').toString().slice(0, 140).replace(/\s+/g, ' ');
  log(settings, 'OUT:', { next: out?.next, preview });
  return out;
}

export default { registry, handle };
