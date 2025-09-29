// configs/bots/claudia/flow/close.js
// Fechamento simples com carimbo. Mantém core neutro.

import { tagReply } from "./_state.js";

export default async function close(ctx = {}) {
  return {
    reply: tagReply(
      ctx,
      "Seu pedido está confirmado 💚 O entregador vai te chamar no WhatsApp para combinar a entrega. Qualquer dúvida, pode falar comigo!",
      "flow/close#confirmed"
    ),
    meta: { tag: "flow/close#confirmed" }
  };
}
