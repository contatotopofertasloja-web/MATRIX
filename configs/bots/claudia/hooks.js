// configs/bots/claudia/hooks.js
// Hooks da Cláudia (opt-in). Anti-rajada + dedupe. SEM perguntar tipo de cabelo.
// Mantém-se 100% alinhado ao funil validado (apresenta, nome, objetivo, oferta).

import { buildPrompt } from "./prompts/index.js";
import { recall, remember } from "../../../src/core/memory.js";

// === Anti-rajada / dedupe por hash de reply ===
function hashStr(s = "") {
  let h = 0, i = 0;
  for (; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  return h;
}

async function shouldSendFallback(jid, reply, settings) {
  if (!reply) return false;
  const now = Date.now();
  const h = hashStr(reply);
  const windowMs = Number(settings?.flags?.reply_dedupe_ms) || 90_000;

  try {
    const saved = await recall(jid);
    const lastH = saved?.__last_fb_hash || null;
    const lastAt = saved?.__last_fb_at || 0;

    if (lastH === h && (now - lastAt) < windowMs) return false;

    await remember(jid, { __last_fb_hash: h, __last_fb_at: now });
  } catch {}
  return true;
}

export const hooks = {
  async safeBuildPrompt({ stage, message, settings = {} }) {
    try {
      const flags = settings?.flags || {};
      if (flags.flow_only === true) return null;
      const p = buildPrompt({ stage, message, settings });
      return p ? { system: p.system, user: p.user, postprocess: p.postprocess } : null;
    } catch { return null; }
  },

  async openingMedia(settings) {
    const url = settings?.media?.opening_photo_url;
    return url ? { type: "image", url, caption: "" } : null;
  },

  // Fallback textual FINAL — opt-in (disable_hooks_fallback === false)
  async fallbackText({ stage, settings = {}, jid }) {
    const flags = settings?.flags || {};
    if (flags.flow_only === true) return null;
    if (flags.disable_hooks_fallback !== false) return null;
    if (String(stage || "").toLowerCase() === "greet") return null;

    const reply =
      "Posso te ajudar com **preço, entrega e pagamento na entrega**. " +
      "Se preferir, já verifico a **promo do dia** e checo seu **CEP** pra liberar o COD. (hooks)";

    const ok = await shouldSendFallback(jid, reply, settings);
    return ok ? reply : null;
  },
};

export default { hooks };
