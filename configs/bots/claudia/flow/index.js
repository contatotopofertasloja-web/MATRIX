// configs/bots/claudia/flow/index.js
import greet from './greet.js';
import qualify from './qualify.js';
import offer from './offer.js';
import objections from './objections.js';
import close from './close.js';
import postsale from './postsale.js';
import faq from './faq.js';
import { pickFlow } from './router.js';
import { initialState } from './_state.js';

function log(...a){ if(process.env.NODE_ENV!=='production') console.log('[CLAUDIA]', ...a); }

export const registry = { greet, qualify, offer, objections, close, postsale, faq };

export async function handle(ctx = {}) {
  ctx.state = ctx.state || {};
  const base = initialState();
  for (const k of Object.keys(base)) if (ctx.state[k] === undefined) ctx.state[k] = base[k];

  const Flow = pickFlow(ctx.text || '', ctx.settings || {}, ctx.state || {});
  log('PICK', Flow.name, 'text=', ctx.text);

  const out = await Flow(ctx);
  log('OUT', { next: out?.next, preview: (out?.reply||'').slice(0,120) });
  return out;
}

export default { registry, handle };
