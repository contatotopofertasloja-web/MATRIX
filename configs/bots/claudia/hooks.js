// configs/bots/claudia/hooks.js
// Hooks da Cláudia. Core neutro; aqui só expomos utilidades.
// >>> Fallback passa a ser OPT-IN via flags.disable_hooks_fallback === false.

import { buildPrompt } from "./prompts/index.js";

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
    } catch {
      return null;
    }
  },

  /** Mídia de abertura (opcional) */
  async openingMedia(settings) {
    const url = settings?.media?.opening_photo_url;
    return url ? { type: "image", url, caption: "" } : null;
  },

  /**
   * Fallback textual FINAL — agora é opt-in.
   * Regras:
   *  - Se flags.flow_only=true → desliga (retorna null).
   *  - Se flags.disable_hooks_fallback=true (padrão) → desliga (retorna null).
   *  - Nunca fala no stage "greet".
   */
  async fallbackText({ stage, settings = {} }) {
    const flags = settings?.flags || {};
    if (flags.flow_only === true) return null;
    if (flags.disable_hooks_fallback !== false) return null; // default: desliga
    if (String(stage || "").toLowerCase() === "greet") return null;
    return "Consigo te orientar certinho! Me diz rapidinho o tipo do seu cabelo (liso, ondulado, cacheado ou crespo)? (hooks)";
  },
};

export default { hooks };
