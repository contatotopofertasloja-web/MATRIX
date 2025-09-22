// configs/bots/claudia/flow/index.js
// Runner do flow da Cláudia: garante state, força boot pelo greet (com foto 1x),
// e depois roteia normalmente via pickFlow. Mantém logs de debug.

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

// Envia a foto de abertura somente 1x por contato (respeita o state da sessão)
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
  // 1) Garantir STATE com os campos padrão (sem sobrescrever já existentes)
  ctx.state = ctx.state || {};
  const base = initialState();
  for (const k of Object.keys(base)) if (ctx.state[k] === undefined) ctx.state[k] = base[k];

  const text = ctx?.text || '';
  const settings = ctx?.settings || {};

  // 2) PRIMEIRA MENSAGEM → sempre iniciar pelo GREET (evita iniciar por "hooks")
  if (!ctx.state.__boot_greet_done) {
    await ensureOpeningPhotoOnce(ctx);               // foto 1x (se ativada no YAML)
    const outGreet = await greet(ctx);               // delega pro greet da bot
    ctx.state.__boot_greet_done = true;
    const preview = (outGreet?.reply || '').toString().slice(0, 140).replace(/\s+/g, ' ');
    log(settings, 'BOOT:GREET', { preview, next: outGreet?.next });
    return outGreet;
  }

  // 3) MENSAGENS SEGUINTES → roteamento normal do teu projeto
  const Flow = pickFlow(text, settings, ctx.state) || greet;
  log(settings, 'PICK:', Flow?.name, '| text=', text);

  const out = await Flow(ctx);

  // Log resumido da saída (ajuda a depurar roteamento)
  const preview = (out?.reply || '').toString().slice(0, 140).replace(/\s+/g, ' ');
  log(settings, 'OUT:', { next: out?.next, preview });

  return out;
}

export default { registry, handle };
