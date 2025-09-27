// configs/bots/claudia/flow/greet.js
// Abertura: pede nome, já informa que serve para todos os tipos de cabelo.
// Se cliente já trouxer objetivo (alisar, frizz, volume, brilho), encaminha pro offer.

import { ensureProfile, tagReply } from "./_state.js";

const RX = {
  NAME: /\b(meu\s*nome\s*é|me\s*chamo|sou)\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,})/i,
  GOAL: /\b(alisar|frizz|volume|brilho)\b/i,
};

export default async function greet(ctx = {}) {
  const { state = {}, text = "" } = ctx;
  const profile = ensureProfile(state);
  const s = String(text).trim();

  const m = s.match(RX.NAME);
  if (m) profile.name = m[2];

  const g = s.match(RX.GOAL);
  if (g) {
    profile.goal = g[1].toLowerCase();
    return { reply: tagReply(ctx, `Prazer, ${profile.name || "💚"}! Nossa Progressiva Vegetal serve para **todos os tipos de cabelo**. Já te passo a condição do dia 🙌`, "flow/greet→offer"), meta: { tag: "flow/greet→offer" } };
  }

  if (!profile.name) {
    return { reply: tagReply(ctx, "Oi! Eu sou a Cláudia 💚 Qual o seu **nome completo**?", "flow/greet#ask_name"), meta: { tag: "flow/greet#ask_name" } };
  }

  return { reply: tagReply(ctx, `Prazer, ${profile.name}! A Progressiva Vegetal serve para **todos os tipos de cabelo**. Qual é o seu objetivo hoje: **alisar, reduzir frizz, baixar volume ou dar brilho de salão em casa**?`, "flow/greet#ask_goal"), meta: { tag: "flow/greet#ask_goal" } };
}
