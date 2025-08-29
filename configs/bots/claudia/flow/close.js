// configs/bots/claudia/flow/close.js
import { settings } from '../../../src/core/settings.js';

export async function closeDeal() {
  const price =
    Number(settings?.business?.price_target ?? settings?.product?.price_target ?? 170).toFixed(0);
  const url = settings?.business?.checkout_url || settings?.product?.checkout_link || '';
  const pay = settings?.business?.payment || 'Pagamento na entrega (COD).';
  const twoMsgs = Boolean(settings?.flags?.send_link_in_two_messages);

  const head = [`Perfeito! Fechamos por R$ ${price} ✅`, pay].join(' ');
  const link = url ? `Link oficial: ${url}` : '';

  // Se preferir enviar em duas mensagens, o handler pode dividir por '\n'
  return twoMsgs && link ? [head, link].join('\n') : [head, link].filter(Boolean).join('\n');
}
