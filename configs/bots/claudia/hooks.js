// configs/bots/claudia/hooks.js
// Hooks da Cláudia. Mantém core neutro; aqui controlamos prompt seguro,
// mídia de abertura e *fallback* (somente quando não houver ação de flow).

import { buildPrompt } from "./prompts/index.js";

export const hooks = {
  /**
   * Prompt seguro. Se flow_only = true, não monta (força os flows).
   * Quando montar, o prompt NUNCA fala de preço/link/parcelas
   * (essa regra é aplicada no buildPrompt desta bot).
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
   * *Fallback* definitivo da bot.
   * IMPORTANTE:
   * - Respeita flags.flow_only (se true, não fala).
   * - NUNCA responde no stage "greet".
   * - Texto curto, sem números ou links, com carimbo "(hooks)".
   */
  async fallbackText({ stage, settings }) {
    const flags = settings?.flags || {};
    if (flags.flow_only === true) return null;
    if (String(stage || "").toLowerCase() === "greet") return null;
    return "Consigo te orientar certinho! Me diz rapidinho o tipo do seu cabelo (liso, ondulado, cacheado ou crespo)? (hooks)";
  },
};

export default { hooks };
