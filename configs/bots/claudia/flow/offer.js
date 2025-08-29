// configs/bots/claudia/flow/offer.js
import { settings } from '../../../src/core/settings.js';

export async function offer() {
  const price =
    Number(settings?.business?.price_target ?? settings?.product?.price_target ?? 170).toFixed(0);

  return [
    'A Progressiva Vegetal trata e alinha sem formol 🌿.',
    `Hoje sai por R$ ${price} e rende até 3 meses.`,
    'Quer que eu te envie o passo a passo pra ver como encaixa na sua rotina?'
  ].join(' ');
}
