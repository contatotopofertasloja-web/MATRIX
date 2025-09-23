// configs/bots/claudia/flow/postsale.js
// Pós-venda simples: confirma acompanhamento + oferece guia de uso/cupom.

import { tagReply, normalizeSettings } from "./_state.js";

export default async function postsale(ctx) {
  const { settings } = ctx;
  const S = normalizeSettings(settings);
  const msgs = [
    "Pagamento confirmado 🎉 Você receberá mensagens para acompanhar a entrega.",
    "Quer que eu te mande o **passo a passo** de aplicação? Posso enviar em 1 imagem.",
  ];
  if (S.product.coupon_code) {
    msgs.push(`Como agradecimento, **cupom** para a PRÓXIMA compra: ${S.product.coupon_code}.`);
  }
  return tagReply(S, msgs.join("\n"), "flow/postsale");
}
