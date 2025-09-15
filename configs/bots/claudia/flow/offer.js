// configs/bots/claudia/flow/offer.js
// Oferta consultiva → só mostra preço/link quando cliente pedir.

import { callUser, getFixed } from "./_state.js";

const RX_PRICE_INTENT = /(preç|valor|quanto|cust)/i;

export default async function offer(ctx) {
  const { text = "", state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;

  const fx = getFixed(settings);
  const askedForPrice = RX_PRICE_INTENT.test(text);

  const priceLine = `De R$${fx.priceOriginal} por **R$${fx.priceTarget}**`;

  if (askedForPrice) {
    state.price_allowed = true;
    return {
      reply: `${priceLine}. Quer que eu te envie o **link seguro do checkout**?`,
      next: "fechamento",
    };
  }

  if (state.price_allowed) {
    return {
      reply: `${priceLine}. Posso já te mandar o link do checkout?`,
      next: "fechamento",
    };
  }

  return {
    reply:
      `Pelo que me contou, a Progressiva X bate certinho com seu objetivo, ${callUser(state)}. ` +
      `É prática, segura e com resultado de salão. Posso **adiantar seu pedido no COD**?`,
    next: "fechamento",
  };
}
