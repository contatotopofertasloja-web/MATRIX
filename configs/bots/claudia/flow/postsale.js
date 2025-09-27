// configs/bots/claudia/flow/postsale.js
// Pós-venda simples.

import { tagReply } from "./_state.js";

export default async function postsale(ctx = {}) {
  return { reply: tagReply(ctx, "Oi 💚 Só passando pra saber se já recebeu o produto direitinho! Está satisfeita com o resultado?", "flow/postsale#checkin"), meta: { tag: "flow/postsale#checkin" } };
}
