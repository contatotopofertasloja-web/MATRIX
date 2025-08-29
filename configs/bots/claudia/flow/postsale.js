// configs/bots/claudia/flow/postsale.js
import { settings } from '../../../src/core/settings.js';

export async function postSale() {
  const coupon = settings?.business?.coupon_code || settings?.product?.coupon_code || '';
  return [
    'Pedido confirmado! 🎉 Obrigado pela confiança.',
    coupon
      ? `Quando sair para entrega te aviso com rastreio. Na próxima, usa o cupom ${coupon} 😉`
      : 'Quando sair para entrega te aviso com rastreio.'
  ].join(' ');
}
