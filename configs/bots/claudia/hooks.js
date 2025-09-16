// configs/bots/claudia/hooks.js
// Hooks da Cláudia. Mantém core neutro; aqui controlamos prompts/fallback e mídia de abertura.
import { buildPrompt } from './prompts/index.js';

export const hooks = {
  /**
   * Prompt seguro. Se flow_only = true, nem monta (força o flow).
   * Se montar, nunca fala preço/link/parcelas e carimba (prompts/index).
   */
  async safeBuildPrompt({ stage, message, settings = {} }) {
    try {
      const flags = settings?.flags || {};
      if (flags.flow_only === true) return null;

      const p = buildPrompt({ stage, message, settings });
      if (!p) return null;

      // Alguns runtimes esperam {system, user}. Se existir postprocessor, repassamos junto.
      return { system: p.system, user: p.user, postprocess: p.postprocess };
    } catch {
      return null;
    }
  },

  /** Foto de abertura (se configurada) */
  async openingMedia(settings) {
    const url = settings?.media?.opening_photo_url;
    return url ? { type: 'image', url, caption: '' } : null;
  },

  /**
   * Fallback definitivo: se algo escapar do flow/prompt, devolve texto curto e carimbado (hooks).
   * Não inclui números nem links.
   */
  async fallbackText(/* ctx, settings */) {
    return "Consigo te orientar certinho! Me diz rapidinho o tipo do seu cabelo (liso, ondulado, cacheado ou crespo)? (hooks)";
  },
};

export default { hooks };
