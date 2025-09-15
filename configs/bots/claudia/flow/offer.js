// configs/bots/claudia/flow/offer.js
import { callUser, getFixed } from "./_state.js";

const RX_PRICE_INTENT = /(preç|valor|quanto|cust)/i;
const RX_LINK_INTENT  = /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho)\b/i;

export default async function offer(ctx) {
  const { text = "", state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;

  const fx = getFixed(settings);
  const askedPrice = RX_PRICE_INTENT.test(text);
  const askedLink  = RX_LINK_INTENT.test(text);

  const now = Date.now();
  const cool = (ts, ms=90_000) => !ts || (now - ts) > ms;

  if (askedLink) {
    state.link_allowed = true;
    state.last_link_at = now;
    return {
      reply: `Posso te mandar o **link seguro do checkout** agora mesmo, ${callUser(state)}. Quer receber?`,
      next: "fechamento",
    };
  }

  if (askedPrice || cool(state.last_offer_at)) {
    state.price_allowed = true;
    state.last_offer_at = now;
    const priceLine = `De R$${fx.priceOriginal} por **R$${fx.priceTarget}**`;
    return {
      reply: `${priceLine}. Quer que eu te envie o **link seguro do checkout**?`,
      next: "fechamento",
    };
  }

  if (state.price_allowed) {
    const priceLine = `Sai **R$${fx.priceTarget}** no **COD** (paga só na entrega). Quer o link agora?`;
    return { reply: priceLine, next: "fechamento" };
  }

  const pitch =
    `Pelo que me contou, essa progressiva bate certinho com teu objetivo, ${callUser(state)}. ` +
    `É prática, segura e com resultado de salão. Quer que eu **adiant(e)** teu pedido no COD?`;
  return { reply: pitch, next: "fechamento" };
}
