// configs/bots/maria/flow/close.js
// Etapa: fechamento. Reforça COD e entrega o link se ainda não enviado.

import { settings } from '../../../../src/core/settings.js';

export const id = 'close';
export const stage = 'fechamento';

export function match(text = '') {
  const t = String(text).toLowerCase();
  return /(comprar|finalizar|fechar|checkout|link)/i.test(t);
}

export async function run(ctx = {}) {
  const link = settings?.product?.checkout_link || '';
  const price = settings?.product?.price_target ?? 170;

  const msgBase = `Perfeito! Pagamento é na entrega (COD).`;
  const withLink = link ? `${msgBase} Segue o link seguro: ${link}` : `${msgBase} Posso te enviar o link agora?`;
  return {
    text: withLink,
    nextStage: 'posvenda',
    actions: link ? ['send_link', 'confirm_cod'] : ['confirm_cod'],
    meta: { price },
  };
}

export default { id, stage, match, run };
