// configs/bots/maria/flow/postsale.js
// Etapa: pós-venda. Usada após confirmação de pagamento (webhook) ou quando o cliente avisa "paguei".

import { settings } from '../../../../src/core/settings.js';

export const id = 'postsale';
export const stage = 'posvenda';

export function match(text = '') {
  const t = String(text).toLowerCase();
  return /(paguei|pagamento feito|comprovante|finalizei)/i.test(t);
}

export async function run(ctx = {}) {
  const lines = settings?.messages?.postsale_pre_coupon || [
    'Pagamento confirmado! 🎉 Você receberá mensagens para acompanhar a entrega.',
  ];

  const out = [];
  for (const line of lines) out.push(line);

  if (settings?.product?.coupon_post_payment_only && settings?.product?.coupon_code) {
    const tpl = settings?.messages?.postsale_after_payment_with_coupon?.[0] || '';
    const txt = tpl.replace('{{coupon_code}}', settings.product.coupon_code);
    if (txt) out.push(txt);
  }

  return { text: out.join('\n'), nextStage: null, actions: ['confirm_payment'] };
}

export default { id, stage, match, run };
