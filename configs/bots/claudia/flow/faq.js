// configs/bots/claudia/flow/faq.js
// FAQ básico com informações do produto.

import { tagReply } from "./_state.js";

export default async function faq(ctx = {}) {
  const { text = "" } = ctx;
  const s = text.toLowerCase();

  if (/quant(o|as) (ml|mililitros|tamanho)/.test(s)) {
    return { reply: tagReply(ctx, "O frasco tem **500ml**, rende de 2 a 4 aplicações dependendo do comprimento.", "flow/faq#volume"), meta: { tag: "flow/faq#volume" } };
  }
  if (/como aplic(a|o|ar)/.test(s)) {
    return { reply: tagReply(ctx, "Lave os cabelos, aplique a progressiva, deixe agir por 40 minutos e finalize com escova/chapinha para maior durabilidade.", "flow/faq#how_to_use"), meta: { tag: "flow/faq#how_to_use" } };
  }
  if (/contraindica(c|ç|ções)/.test(s)) {
    return { reply: tagReply(ctx, "Não recomendamos para gestantes ou lactantes. Fora isso, é **segura e liberada pela Anvisa**.", "flow/faq#contraindication"), meta: { tag: "flow/faq#contraindication" } };
  }

  return { reply: tagReply(ctx, "Pode me perguntar sobre tamanho, rendimento, aplicação ou contraindicações 💚", "flow/faq#fallback"), meta: { tag: "flow/faq#fallback" } };
}
