// configs/bots/claudia/flow/offer.js
import { callUser, getFixed } from "./_state.js";

const RX_PRICE = /(preç|valor|quanto|cust)/i;
const RX_LINK  = /\b(link|checkout|comprar|finaliza(r)?|fechar|pagamento|carrinho)\b/i;

export default async function offer(ctx) {
  const { text = "", state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;

  const fx = getFixed(settings);
  const askedPrice = RX_PRICE.test(text);
  const askedLink  = RX_LINK.test(text);

  // Guardrail: só vendemos Progressiva Vegetal via WhatsApp
  if (/shampoo|óleo|oleo|m[aá]scara|kit|outros\s+produtos/i.test(text)) {
    return {
      reply: `Aqui no WhatsApp eu cuido só da *Progressiva Vegetal*, tá? 💇‍♀️ Ela sai por **R$${fx.priceTarget}** no COD e rende **${fx.applications}**. Quer o **link** agora?`,
      next: "fechamento",
    };
  }

  const now = Date.now();
  const cool = (ts, ms=90_000) => !ts || (now - ts) > ms;

  // Se pedir link (ou já estiver liberado), manda direto
  if (askedLink || state._sales.link_allowed) {
    state._sales.link_allowed = false;
    state._sales.last_link_at = now;
    const msg =
      `Aqui está o **link seguro do checkout**: ${fx.checkout_link}\n` +
      `Preço: **R$${fx.priceTarget}** no pagamento na entrega (COD). ` +
      `Rende **${fx.applications}**.`;
    return { reply: msg, next: "fechamento" };
  }

  // Se pedir preço (ou no cooldown)
  if (askedPrice || cool(state._sales.last_offer_at)) {
    state._sales.last_offer_at = now;
    state._sales.link_allowed = true;
    const priceLine = `A *Progressiva Vegetal* está de R$${fx.priceOriginal} por **R$${fx.priceTarget}**.`;
    const note = `Rende **${fx.applications}**. Te envio o **link** pra finalizar?`;
    return { reply: `${priceLine} ${note}`, next: "fechamento" };
  }

  // Pitch curto e humano
  const nome = callUser(state);
  const pitch = `Pelo que me contou, ${nome}, essa progressiva é pra ti: alinha, reduz frizz e dá brilho. Te mando o **link** pra garantir agora?`;
  return { reply: pitch, next: "fechamento" };
}
