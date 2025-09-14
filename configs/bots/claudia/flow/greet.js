import { callUser } from "./_state.js";

export default async function greet(ctx) {
  const { state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;

  if (!state.asked_name_once) {
    state.asked_name_once = true;
    return {
      reply: `Oi, ${callUser(state)}! 💖 Eu sou a Cláudia da ${settings?.company_name || "TopOfertas"}. Me conta seu **nome** e como é seu **cabelo** (liso, ondulado, cacheado ou crespo)?`,
      next: "qualificacao",
    };
  }

  return {
    reply: `Tô aqui pra te ajudar, ${callUser(state)}! Me diz seu **nome** e o **tipo de cabelo** pra eu te orientar certinho.`,
    next: "qualificacao",
  };
}
