import { callUser } from "./_state.js";

export default async function qualify(ctx) {
  const { text = "", state } = ctx;
  state.turns = (state.turns || 0) + 1;
  const t = text.toLowerCase();

  // captura nome (simplificado)
  if (!state.nome && /\b(meu nome|sou|chamo|nome)\b/.test(t)) {
    const m = text.replace(/\s+/g, " ").match(/(?:meu nome é|sou|me chamo)\s+([\p{L}.'\- ]{2,})/iu);
    if (m) state.nome = m[1].trim();
  }
  // tipo de cabelo
  if (!state.tipo_cabelo) {
    if (/liso/.test(t)) state.tipo_cabelo = "liso";
    else if (/ondulad/.test(t)) state.tipo_cabelo = "ondulado";
    else if (/cachead/.test(t)) state.tipo_cabelo = "cacheado";
    else if (/cresp/.test(t)) state.tipo_cabelo = "crespo";
  }

  // pergunta objetivo
  if (!state.objetivo) {
    return {
      reply: `Perfeito, ${callUser(state)}! Qual seu objetivo hoje? **Alisar**, **reduzir volume**, **controlar frizz** ou **dar brilho**? Posso te guiar 😉`,
      next: "oferta",
    };
  }

  // reforço breve (sem preço)
  return {
    reply: `Legal! É um tratamento seguro e prático, ${callUser(state)}. Rende bem e dura bastante (varia com os cuidados). Quer que eu te explique como usar ou prefere seguir para o próximo passo?`,
    next: "oferta",
  };
}
