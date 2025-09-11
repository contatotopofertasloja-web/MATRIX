// configs/bots/claudia/hooks.js
// Hooks específicos da Cláudia. Identidade e preferências ficam neste nível.
// Os demais comportamentos caem nos defaults genéricos.

import { buildPrompt } from './prompts/index.js';

export const hooks = {
  async safeBuildPrompt({ stage, message /*, settings */ }) {
    // Usa o builder de prompt da Cláudia. Se falhar, o registry cai no default.
    try {
      const p = buildPrompt({ stage, message });
      if (p && (p.system || p.user)) return p;
    } catch {}
    return null; // força fallback genérico do registry
  },

  // Se quiser personalizar fallbackText/openingMedia/onPaymentConfirmed para a Cláudia,
  // exporta aqui; caso contrário, defaults genéricos serão usados.
  
};
export default { hooks };
