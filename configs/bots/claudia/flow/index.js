// configs/bots/claudia/flow/index.js
import greet from './greet.js';
import qualify from './qualify.js';
import offer from './offer.js';
import close from './close.js';
import postsale from './postsale.js';
import { pickFlow } from './router.js';
import { initialState, gate } from './_state.js';
import { recall, remember } from "../../../../src/core/memory.js";

export const registry = { greet, qualify, offer, close, postsale };

function shouldLog(settings) {
  return process.env.NODE_ENV !== 'production' || settings?.flags?.debug_log_router === true;
}
function log(settings, ...a) {
  if (shouldLog(settings)) console.log('[CLAUDIA_ROUTER]', ...a);
}

// hash simples de string
function hashStr(s = '') {
  let h = 0, i = 0, len = s.length;
  while (i < len) { h = (h << 5) - h + s.charCodeAt(i++) | 0; }
  return h;
}

// janela configurável (settings.flags.reply_dedupe_ms > env > default 45s)
function getDedupeWindowMs(settings) {
  const fromSettings = Number(settings?.flags?.reply_dedupe_ms);
  const fromEnv = Number(process.env.REPLY_DEDUPE_MS);
  return Number.isFinite(fromSettings) && fromSettings > 0
    ? fromSettings
    : (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 45_000);
}

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

// De-dupe por tick
function dedupeTick(ctx, out) {
  if (!out || !out.reply) return out;
  const reply = String(out.reply);
  ctx.__tickSet = ctx.__tickSet || new Set();
  const h = hashStr(reply);
  if (ctx.__tickSet.has(h)) {
    return { reply: null, next: out.next, meta: out.meta };
  }
  ctx.__tickSet.add(h);
  return out;
}

// De-dupe persistente (Redis/RAM)
async function dedupePersistent(ctx, out) {
  if (!out || !out.reply) return out;
  const reply = String(out.reply);
  const h = hashStr(reply);
  const now = Date.now();
  const windowMs = getDedupeWindowMs(ctx.settings);

  const saved = await recall(ctx.jid);
  const lastH = saved?.__last_reply_hash ?? ctx.state.__last_reply_hash ?? null;
  const lastAt = saved?.__last_reply_at ?? ctx.state.__last_reply_at ?? 0;

  if (lastH === h && (now - lastAt) < windowMs) {
    return { reply: null, next: out.next, meta: out.meta };
  }

  ctx.state.__last_reply_hash = h;
  ctx.state.__last_reply_at   = now;
  await remember(ctx.jid, { __last_reply_hash: h, __last_reply_at: now });

  return out;
}

export async function handle(ctx = {}) {
  ctx.state = ctx.state || {};
  const base = initialState();
  for (const k of Object.keys(base)) if (ctx.state[k] === undefined) ctx.state[k] = base[k];

  const text = ctx?.text || '';
  const settings = ctx?.settings || {};
  ctx.state.turns = (ctx.state.turns || 0) + 1;

  // 🔒 trava geral anti-rajada
  if (gate(ctx.state, '__any_out', 1200)) {
    log(settings, 'GATE: __any_out (drop burst)');
    return { reply: null, next: undefined };
  }

  // 🚀 primeiro turno → greet 1x
  if (!ctx.state.__boot_greet_done) {
    if (gate(ctx.state, 'boot_greet', 5000)) {
      log(settings, 'GATE: boot_greet (duplicate)');
      return { reply: null, next: 'greet' };
    }
    await ensureOpeningPhotoOnce(ctx);
    let outGreet = await greet(ctx);
    outGreet = dedupeTick(ctx, outGreet);
    outGreet = await dedupePersistent(ctx, outGreet);
    ctx.state.__boot_greet_done = true;

    const preview = (outGreet?.reply || '').toString().slice(0, 140).replace(/\s+/g, ' ');
    log(settings, 'BOOT:GREET', { preview, next: outGreet?.next });
    return outGreet;
  }

  // ➡️ mensagens seguintes
  const Flow = await pickFlow(text, settings, ctx.state, ctx.jid) || qualify;
  log(settings, 'PICK:', Flow?.name, '| text=', text);

  let out = await Flow(ctx);
  out = dedupeTick(ctx, out);
  out = await dedupePersistent(ctx, out);

  const preview = (out?.reply || '').toString().slice(0, 140).replace(/\s+/g, ' ');
  log(settings, 'OUT:', { next: out?.next, preview });
  return out;
}

export default { registry, handle };
