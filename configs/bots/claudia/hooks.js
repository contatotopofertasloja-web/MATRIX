// configs/bots/claudia/hooks.js
// Hooks específicos da Cláudia — identidade e preferências ficam aqui.
// O core deve permanecer neutro.
import { buildPrompt } from './prompts/index.js';

export const hooks = {
  /**
   * Se flags.flow_only === true, NÃO monta prompt → força o core a usar o flow.
   * Caso contrário, monta um prompt seguro que NUNCA pede preço/link nem chama tools.
   */
  async safeBuildPrompt({ stage, message, settings = {} }) {
    try {
      const flags = settings?.flags || {};
      if (flags.flow_only === true) return null; // força fluxo determinístico

      // Monta prompt “domesticado” (sem números/links, sem TOOLS)
      const p = buildPrompt({ stage, message, settings });
      if (p && (p.system || p.user)) return p;
    } catch {}
    return null; // fallback do registry → flow
  },

  async openingMedia(settings) {
    const url = settings?.media?.opening_photo_url;
    return url ? { type: 'image', url, caption: '' } : null;
  },

  async fallbackText(/*ctx, settings*/) {
    // Fallback super curto, que empurra para qualificação (sem preço/link)
    return 'Consegue me contar rapidinho como é seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?) (hooks)';
  },

  async onPaymentConfirmed(ctx, settings) {
    for (const line of settings?.messages?.postsale_pre_coupon ?? []) {
      await ctx.outbox.publish({ to: ctx.jid, kind: 'text', payload: { text: line } });
    }
    if (settings?.product?.coupon_post_payment_only && settings?.product?.coupon_code) {
      const tpl = settings?.messages?.postsale_after_payment_with_coupon?.[0] || '';
      const txt = tpl.replace('{{coupon_code}}', settings.product.coupon_code);
      if (txt) await ctx.outbox.publish({ to: ctx.jid, kind: 'text', payload: { text: txt } });
    }
  },
};
export default { hooks };
