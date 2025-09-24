// configs/bots/claudia/flow/postsale.js
// Pós-venda da Cláudia (pagamento confirmado, confirmação de pedido, dicas rápidas e cupom opcional)

import { settings } from '../../../../src/core/settings.js';
import { setStage } from '../../../../src/core/fsm.js';

/**
 * Regras de negócio (lidas do settings.yaml):
 * - messages.postsale_pre_coupon: linhas enviadas imediatamente após confirmação de pagamento
 * - product.coupon_post_payment_only: se true, cupom só aparece aqui no pós-pagamento
 * - product.coupon_code: código a ser inserido no template
 * - messages.postsale_after_payment_with_coupon: template(s) que serão preenchidos com {{coupon_code}}
 * - messages.postsale_followup_days: dias até um lembrete de acompanhamento (somente texto informativo aqui)
 *
 * Observação:
 * - Este flow retorna **um único texto** (consolidado em 2–4 linhas), para evitar “rajada” de bolhas.
 * - O link do checkout NÃO é repetido aqui. É só confirmação + instruções.
 */

function linesToText(lines = []) {
  return (lines || [])
    .map((l) => String(l || '').trim())
    .filter(Boolean)
    .join('\n');
}

export async function postsale({ userId, text, event = 'paid' }) {
  // marca estágio
  await setStage(userId, 'postsale');

  const msgs = [];
  const msgBlock = (settings?.messages || {});
  const product  = (settings?.product || {});

  // 1) pacote "pago com sucesso"
  const pre = Array.isArray(msgBlock.postsale_pre_coupon) ? msgBlock.postsale_pre_coupon : [];

  if (pre.length) {
    msgs.push(linesToText(pre));
  } else {
    // fallback curto e assertivo
    msgs.push(
      'Pagamento confirmado! 🎉 Você receberá mensagens pelo WhatsApp para agendar e acompanhar a entrega.',
      'Se pintar qualquer imprevisto com o horário, é só avisar o entregador pelo próprio WhatsApp. 💚'
    );
  }

  // 2) cupom (apenas se configurado para aparecer após pagamento)
  const canCoupon = !!product?.coupon_post_payment_only && !!product?.coupon_code;
  const tpl = (Array.isArray(msgBlock.postsale_after_payment_with_coupon) ? msgBlock.postsale_after_payment_with_coupon : [])
    .map((t) => String(t || '').replace(/\{\{coupon_code\}\}/g, String(product.coupon_code || '')))
    .filter((t) => t.trim());

  if (canCoupon && tpl.length) {
    msgs.push(tpl[0]); // 1 linha só, pra ficar elegante
  }

  // 3) lembrete de acompanhamento (apenas informativo aqui)
  const days = Number(settings?.messages?.postsale_followup_days || 0);
  if (Number.isFinite(days) && days > 0) {
    msgs.push(`Daqui a ${days} dia${days > 1 ? 's' : ''} eu te mando um lembrete com dicas rápidas de aplicação e manutenção ✨`);
  }

  // saída consolidada (2–4 linhas no total)
  return linesToText(msgs);
}

export default postsale;
