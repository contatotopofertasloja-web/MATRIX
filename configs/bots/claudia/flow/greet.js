// configs/bots/claudia/flow/greet.js
import { callUser, getFixed } from "./_state.js";

export default async function greet(ctx) {
  const { state, settings } = ctx;
  const fx = getFixed(settings);

  if (!state.asked_name_once) {
    state.asked_name_once = true;
    return {
      reply: `Oi, ${callUser(state)}! 💖 Eu sou a Cláudia da ${fx.empresa}. Uso a Progressiva Vegetal e amo o resultado. Me conta seu **nome** e como é seu **cabelo** (liso, ondulado, cacheado ou crespo)?`,
      next: "qualificacao",
    };
  }

  // fallback amigável
  return {
    reply: `Tô aqui pra te ajudar, ${callUser(state)}! Me diz seu **nome** e seu **tipo de cabelo** (liso, ondulado, cacheado ou crespo) pra eu te orientar certinho.`,
    next: "qualificacao",
  };
}
