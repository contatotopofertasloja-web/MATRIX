// configs/bots/claudia/flow/offer.js
import { callUser, getFixed, tagReply } from "./_state.js";

const RX = {
  PRICE: /(preç|valor|quanto|cust)/i,
  LINK:  /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho|pagamento)\b/i,
};

export default async function offer(ctx) {
  const { text = "", state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;

  const fx   = getFixed(settings);
  const link = settings?.product?.checkout_link || "";

  if (RX.LINK.test(text) || state.link_allowed) {
    state.link_allowed = false;
    const msg = `Aqui o **checkout seguro**: ${link}\nPreço: **R$${fx.priceTarget}** (COD — paga quando recebe). Rende ${fx.applications}.`;
    return { reply: tagReply(settings, msg, "flow/offer"), next: "fechamento" };
  }

  if (RX.PRICE.test(text) || state.price_allowed) {
    state.price_allowed = false;
    const priceLine = `De R$${fx.priceOriginal} por **R$${fx.priceTarget}**.`;
    const note = `Rende ${fx.applications}. Quer o **link** pra finalizar?`;
    return { reply: tagReply(settings, `${priceLine} ${note}`, "flow/offer"), next: "fechamento" };
  }

  const pitch = `Pelo que me contou, essa progressiva bate certinho com teu objetivo, ${callUser(state)}. Quer que eu já te envie o **link seguro**?`;
  return { reply: tagReply(settings, pitch, "flow/offer"), next: "fechamento" };
}
