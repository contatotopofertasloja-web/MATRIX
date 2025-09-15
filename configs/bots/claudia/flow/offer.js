import { callUser, getFixed } from "./_state.js";

const RX_PRICE_INTENT = /(preç|valor|quanto|cust)/i;

export default async function offer(ctx) {
  const { text = "", state } = ctx;
  state.turns = (state.turns || 0) + 1;

  const fx = getFixed(ctx.settings);
  const askedForPrice = RX_PRICE_INTENT.test(text);

  if (askedForPrice) {
    state.asked_price_once = true;
    state.price_allowed = true;
    const p = `De ${fx.priceOriginal} por **R$${fx.priceTarget}**`;
    return {
      reply:
        `Pra você ter noção, ${callUser(state)}: ${p} no **COD** (paga só ao receber) + **7 dias** de garantia.\n` +
        `Já ajudamos **${fx.soldCount.toLocaleString("pt-BR")}+** clientes.\n` +
        `Quer que eu **adicione seus dados** rapidinho e deixe tudo pronto?`,
      next: "fechamento",
    };
  }

  if (!state.price_allowed) {
    return {
      reply:
        `Pelo que me contou, a Progressiva X bate certinho com seu objetivo, ${callUser(state)}. ` +
        `É prática, segura e deixa o cabelo com acabamento de salão. ` +
        `Posso **adiantar seu pedido no COD** e te mando um resumo pra você conferir?`,
      next: "fechamento",
    };
  }

  return {
    reply: `Posso seguir e adiantar seu pedido no **COD**, ${callUser(state)}? Te mando um resumão pra conferir 😌`,
    next: "fechamento",
  };
}
