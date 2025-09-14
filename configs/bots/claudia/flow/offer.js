// configs/bots/claudia/flow/offer.js
import { callUser, getFixed } from "./_state.js";

export default async function offer(ctx) {
  const { text = "", state, settings } = ctx;
  const fx = getFixed(settings);
  const t = text.toLowerCase();

  // se pedirem preço cedo, responder sem link (âncora + prova social + COD + garantia + sorteio)
  if (/preç|valor|quanto|cust/.test(t)) {
    state.asked_price_once = true;
    const p = `De ${fx.priceOriginal} por **R$${fx.priceTarget}**`;
    return {
      reply:
        `Pra você ter noção, ${callUser(state)}: ${p} no **COD** (paga só ao receber) + garantia de **7 dias**.\n` +
        `A gente já ajudou **${fx.soldCount.toLocaleString("pt-BR")}+** clientes, e todo mês tem **sorteio** 🎁. ` +
        `Quer que eu **adicione seus dados** rapidinho e deixe tudo pronto?`,
      next: "fechamento",
    };
  }

  // se perguntarem rendimento/duração
  if (/quantas|aplica|rende|dura|mes(es)?/.test(t)) {
    return {
      reply: `Rende **${fx.applications}** e dura **${fx.duration}**, ${callUser(state)}. Com rotina certinha, o resultado fica ainda mais lindo ✨. Quer que eu te diga como usar, ou prefere já agilizar o pedido no **COD**?`,
      next: "fechamento",
    };
  }

  // resposta padrão de oferta (sem preço se não pediram)
  if (!state.asked_price_once) {
    return {
      reply:
        `Pelo que me contou, a Progressiva Vegetal bate certinho com seu objetivo, ${callUser(state)}. ` +
        `É prática, segura e deixa o cabelo com acabamento de salão.\n` +
        `Se quiser, eu já **adianto seu pedido no COD** e você só confere. Pode ser?`,
      next: "fechamento",
    };
  }

  // fallback
  return {
    reply: `Posso seguir e adiantar seu pedido no **COD**, ${callUser(state)}? Prometo agilizar e te mandar um resumo pra conferir 😌`,
    next: "fechamento",
  };
}
