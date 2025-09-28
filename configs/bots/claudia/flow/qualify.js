// configs/bots/claudia/flow/qualify.js
// Simplificado: registra nome/objetivo e ACIONA o offer (state.stage = offer.ask_cep_city)

import { ensureProfile, tagReply } from "./_state.js";
import { remember, recall } from "../../../../src/core/memory.js";

const RX = {
  NAME: /\b(meu\s*nome\s*é|me\s*chamo|sou)\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,})/i,
  GOAL: /\b(alisar|frizz|volume|brilho)\b/i,
};

export default async function qualify(ctx = {}) {
  const { jid, state = {}, text = "" } = ctx;
  const s = String(text).trim();
  const p = ensureProfile(state);

  const saved = await recall(jid).catch(() => null);
  if (saved?.profile) state.profile = { ...p, ...saved.profile };

  const m = s.match(RX.NAME);
  if (m) p.name = m[2];
  const g = s.match(RX.GOAL);
  if (g) p.goal = g[1].toLowerCase();

  await remember(jid, { profile: state.profile });

  // Quando concluímos a qualificação, já deixamos o próximo estágio preparado
  if (p.goal || p.name) {
    state.stage = "offer.ask_cep_city"; // <- chave para o router cair em offer
  }

  if (p.name && p.goal) {
    return { reply: tagReply(ctx, `Perfeito, ${p.name}! Já consigo verificar a promoção do dia 🙌`, "flow/qualify→offer"), meta: { tag: "flow/qualify→offer" } };
  }

  if (!p.goal) {
    return { reply: tagReply(ctx, "Qual é o seu objetivo: **alisar, reduzir frizz, baixar volume ou dar brilho de salão em casa**?", "flow/qualify#ask_goal"), meta: { tag: "flow/qualify#ask_goal" } };
  }

  return { reply: tagReply(ctx, "Ótimo! Vou te passar as condições agora.", "flow/qualify→offer"), meta: { tag: "flow/qualify→offer" } };
}
