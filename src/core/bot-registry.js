// src/core/bot-registry.js
// Carrega hooks do bot atual (configs/bots/<BOT_ID>/hooks.js) e
// completa com defaults genéricos.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as defaults from './bot-defaults.js';
import { BOT_ID } from './settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..', '..');

let _cached = null;

async function tryLoadBotHooks(botId = BOT_ID) {
  try {
    const hooksPath = path.join(ROOT, 'configs', 'bots', botId, 'hooks.js');
    const mod = await import(pathToFileURL(hooksPath).href);
    return mod?.hooks || mod?.default || {};
  } catch {
    return {};
  }
}

function wrapHook(primary, fallback) {
  return async (...args) => {
    try {
      if (typeof primary === 'function') {
        const out = await primary(...args);
        if (primary.name.includes('safeBuildPrompt')) {
          if (out && (out.system || out.user)) return out;
        } else {
          if (out) return out;
        }
      }
    } catch (e) {
      console.warn('[bot-registry] hook error:', e?.message || e);
    }
    return await fallback(...args);
  };
}

export async function getBotHooks() {
  if (_cached) return _cached;
  const botHooks = await tryLoadBotHooks(BOT_ID);
  const hooks = {
    safeBuildPrompt:     wrapHook(botHooks.safeBuildPrompt,     defaults.safeBuildPrompt),
    fallbackText:        wrapHook(botHooks.fallbackText,        defaults.fallbackText),
    openingMedia:        wrapHook(botHooks.openingMedia,        defaults.openingMedia),
    onPaymentConfirmed:  wrapHook(botHooks.onPaymentConfirmed,  defaults.onPaymentConfirmed),
  };
  _cached = hooks;
  return hooks;
}
export default getBotHooks;
