// configs/bots/claudia/hooks.js
// Hooks da Cláudia. Core neutro; aqui só expomos utilidades.
// >>> Fallback passa a ser OPT-IN via flags.disable_hooks_fallback === false.
// >>> Revisado com anti-rajada (gate temporal + dedupe hash) para evitar rajadas.
// >>> Agora usa memória unificada (src/core/memory.js).

import { buildPrompt } from "./prompts/index.js";
import { recall, remember } from "../../../src/core/memory.js";

// === Helpers de anti-rajada/dedupe ===
function hashStr(s = "") {
  let h = 0, i = 0, len = s.length;
  while (i < len) { h = (h << 5) - h + s.charCodeAt(i++) | 0; }
  return h;
}

async function shouldSendFallback(jid, reply, settings) {
  if (!reply) return false;

  const now = Date.now();
  const h = hashStr(reply);

  const windowMs = Number(settings?.flags?.reply_dedupe_ms) || 90_000; // default 90s
  try {
    const saved = await recall(jid);
    const lastH = saved?.__last_fb_hash || null;
    const lastAt = saved?.__last_fb_at || 0;

    if (lastH === h && (now - lastAt) < windowMs) {
      console.log(`[hooks] supressão de rajada jid=${jid} hash=${h}`);
      return false; // já mandou recentemente
    }

    await remember(jid, { __last_fb_hash: h, __last_fb_at: now });
  } catch (e) {
    console.warn("[hooks.shouldSendFallback]", e?.message);
  }
  return true;
}

export const hooks = {
  /**
   * Prompt seguro para freeform do LLM.
   * Se flow_only=true, não monta — a conversa fica 100% confinada nos flows.
   */
  async safeBuildPrompt({ stage, message, settings = {} }) {
    try {
      const flags = settings?.flags || {};
      if (flags.flow_only === true) return null;
      const p = buildPrompt({ stage, message, settings });
      if (!p) return null;
      return { system: p.system, user: p.user, postprocess: p.postprocess };
    } catch (e) {
      console.warn("[hooks.safeBuildPrompt]", e?.message);
      return null;
    }
  },

  /** Mídia de abertura (opcional) */
  async openingMedia(settings) {
    const url = settings?.media?.opening_photo_url;
    return url ? { type: "image", url, caption: "" } : null;
  },

  /**
   * Fallback textual FINAL — agora é opt-in e com anti-rajada.
   * Regras:
   *  - Se flags.flow_only=true → desliga (retorna null).
   *  - Se flags.disable_hooks_fallback=true (padrão) → desliga (retorna null).
   *  - Nunca fala no stage "greet".
   *  - Garante no máximo 1 saída a cada windowMs (default 90s) por contato/hash.
   */
  async fallbackText({ stage, settings = {}, jid }) {
    const flags = settings?.flags || {};
    if (flags.flow_only === true) return null;
    if (flags.disable_hooks_fallback !== false) return null; // default: desligado
    if (String(stage || "").toLowerCase() === "greet") return null;

    const reply = "Consigo te orientar certinho! Me diz rapidinho o tipo do seu cabelo (liso, ondulado, cacheado ou crespo)? (hooks)";

    const ok = await shouldSendFallback(jid, reply, settings);
    if (ok) {
      console.log(`[hooks] fallback disparado jid=${jid} stage=${stage}`);
      return reply;
    }
    return null;
  },
};

export default { hooks };
