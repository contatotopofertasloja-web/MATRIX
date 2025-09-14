import { callUser, getFixed } from "./_state.js";

const RX_PRICE_INTENT = /(preç|valor|quanto|cust)/i;

export default async function offer(ctx) {
  const { text = "", state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;

  const fx = getFixed(settings);
  const askedForPrice = RX_PRICE_INTENT.test(text);

  // Se a cliente pedir preço → libera o gate e ancora
  if (askedForPrice) {
    state.asked_price_once = true;
    state.price_allowed = true;
    const p = `De ${fx.priceOriginal} por **R$${fx.priceTarget}**`;
    return {
      reply:
        `Pra você ter noção, ${callUser(state)}: ${p} no **COD** (paga só ao receber) + **7 dias** de garantia.\n` +
        `A gente já ajudou **${fx.soldCount.toLocaleString("pt-BR")}+** clientes, e todo mês tem **sorteio** 🎁.\n` +
        `Quer que eu **adicione seus dados** rapidinho e deixe tudo pronto?`,
      next: "fechamento",
    };
  }

  // Se AINDA NÃO liberou preço, não mostra número
  if (!state.price_allowed) {
    return {
      reply:
        `Pelo que me contou, a Progressiva Vegetal bate certinho com seu objetivo, ${callUser(state)}. ` +
        `É prática, segura e deixa o cabelo com acabamento de salão. ` +
        `Se quiser, eu já **adianto seu pedido no COD** e te mando um resumo pra você conferir. Pode ser?`,
      next: "fechamento",
    };
  }

  // Se já liberou preço antes, mas agora não pediu — mantém conversa pro fechamento sem repetir valores
  return {
    reply: `Posso seguir e adiantar seu pedido no **COD**, ${callUser(state)}? Prometo agilizar e te mandar um resumo pra conferir 😌`,
    next: "fechamento",
  };
}
