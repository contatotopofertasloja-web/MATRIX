// configs/bots/claudia/flow/close.js
// Fechamento curto com COD + prazo + link.

import { callUser, tagReply, normalizeSettings } from "./_state.js";

export default async function close(ctx) {
  const { state, settings } = ctx;
  const S = normalizeSettings(settings);
  state.turns = (state.turns || 0) + 1;

  const name = callUser(state);
  const lines = [
    `${name ? "Perfeito, " + name + "!" : "Perfeito!"} Te envio o **checkout seguro** agora 🛒`,
    `Condição: de R$${S.product.price_original} por **R$${S.product.price_target}**.`,
    S.product.checkout_link ? `👉 Finalize aqui: ${S.product.checkout_link}` : "",
    `Prazo: **${S.product.delivery_sla.capitals_hours}h** capitais / **${S.product.delivery_sla.others_hours}h** demais regiões.`,
    `Pagamento é **na entrega (COD)**. Qualquer dúvida, tô aqui 💚`,
  ].filter(Boolean);

  const msg = lines.join("\n");
  // Sinaliza que esta resposta contem link (para sanitização permitir)
  return { reply: tagReply(S, msg, "flow/close->postsale"), next: "postsale", meta: { allowLink: true } };
}
