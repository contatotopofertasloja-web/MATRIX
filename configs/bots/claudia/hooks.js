// configs/bots/claudia/prompts/hooks.js
// Hooks específicos da Cláudia — identidade e preferências ficam aqui.
// O core deve permanecer neutro.
import { buildPrompt } from './prompts/index.js';

export const hooks = {
  async safeBuildPrompt({ stage, message, settings }) {
    try {
      const p = buildPrompt({ stage, message, settings });
      if (p && (p.system || p.user)) return p;
    } catch {}
    return null; // força fallback genérico do registry
  },

  // Mídia de abertura (se tiver URL no settings)
  async openingMedia(settings) {
    const url = settings?.media?.opening_photo_url;
    return url ? { type: 'image', url, caption: '' } : null;
  },

  // Texto de fallback curto (qualificação mínima)
  async fallbackText(/*ctx, settings*/) {
    return 'Consegue me contar rapidinho como é seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?)';
  },

  // Pós-pagamento (mensagens configuráveis no YAML)
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
