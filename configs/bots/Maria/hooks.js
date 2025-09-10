// configs/bots/maria/hooks.js
// Hooks específicos da Maria. Se algo falhar, o bot-registry cai nos defaults genéricos.

import { buildPrompt } from './prompts/index.js';

export const hooks = {
  async safeBuildPrompt({ stage, message /*, settings */ }) {
    try {
      const p = buildPrompt({ stage, message });
      if (p && (p.system || p.user)) return p;
    } catch {}
    return null; // força fallback genérico do registry
  },

  // Se quiser, você pode customizar estes também:
  // fallbackText: async ({ stage, message, settings }) => "texto...",
  // openingMedia: async ({ settings }) => ({ url: "...", caption: "" }),
  // onPaymentConfirmed: async ({ jid, settings, send }) => { ... },
};

export default { hooks };
