// configs/bots/claudia/flow/offer.js
import { callUser, getFixed, tagReply } from "./_state.js";

const RX_PRICE_INTENT = /(preç|valor|quanto|cust)/i;
const RX_LINK_INTENT  = /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho|pagamento)\b/i;

export default async function offer(ctx) {
  const { text = "", state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;

  const fx = getFixed(settings);
  const askedPrice = RX_PRICE_INTENT.test(text);
  const askedLink  = RX_LINK_INTENT.test(text);

  const now = Date.now();
  const cool = (ts, ms=90_000) => !ts || (now - ts) > ms;

  // Link primeiro, se pediu
  if (askedLink || state.link_allowed) {
    const link = settings?.product?.checkout_link || "";
    const msg  = `Aqui está o **link seguro do checkout**: ${link}\n` +
                 `Preço: **R$${fx.priceTarget}** no COD (paga só na entrega). ` +
                 `Rende ${fx.applications}.`;
    state.link_allowed = false;
    state.last_link_at = now;
    return { reply: tagReply(settings, msg, "flow/offer"), next: "fechamento" };
  }

  // Se pediu preço (ou passou o cooldown)
  if (askedPrice || cool(state.last_offer_at)) {
    state.price_allowed = true;
    state.last_offer_at = now;
    const priceLine = `A *Progressiva Vegetal* está de R$${fx.priceOriginal} por **R$${fx.priceTarget}**.`;
    const note = `Rende ${fx.applications}. Quer o **link** pra finalizar?`;
    return { reply: tagReply(settings, `${priceLine} ${note}`, "flow/offer"), next: "fechamento" };
  }

  // Pitch consultivo
  const pitch =
    `Pelo que me contou, essa progressiva bate certinho com teu objetivo, ${callUser(state)}. ` +
    `Resultado de salão e aplicação prática em casa. Quer que eu já te encaminhe o **link seguro** pra fechar?`;
  return { reply: tagReply(settings, pitch, "flow/offer"), next: "fechamento" };
}
