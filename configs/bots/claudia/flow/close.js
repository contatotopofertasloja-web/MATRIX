// configs/bots/claudia/flow/close.js
// Flow de Fechamento (Cláudia - Progressiva Vegetal)
// Ajustado: não coleta dados da cliente, apenas envia link de checkout.
// Fonte: (2127 - close.txt) + (DADOS DA PROGRESSIVA VEGETAL.txt)

import { settings } from "../../../src/core/settings.js";

export async function close({ userId, text, context }) {
  const { product, messages } = settings;

  // Mensagem principal de fechamento
  const closing = messages?.closing?.[0] || 
    `Perfeito! Te envio o link do checkout agora 🛒 Pagamento é na entrega (COD).`;

  // Link de checkout (settings.yaml → product.checkout_link)
  const link = product?.checkout_link || "https://tpofertas.com/checkout";

  // Cupom (se configurado)
  const coupon = product?.coupon_code ? 
    `\n\n✨ Cupom exclusivo: *${product.coupon_code}* (aplica no checkout).` 
    : "";

  // Mensagem final
  const reply = `${closing}\n\n👉 Clique aqui para finalizar: ${link}${coupon}`;

  return reply;
}

export default close;
