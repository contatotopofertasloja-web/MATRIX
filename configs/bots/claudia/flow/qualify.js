// configs/bots/claudia/flow/qualify.js
// Slot-filling com memória persistente

import {
  ensureProfile, ensureAsked, markAsked, isFilled,
  callUser, tagReply, filledSummary
} from "./_state.js";
import { remember, recall } from "../../../../src/core/memory.js";

const RX = {
  NAME:  /\b(meu\s*nome\s*é|me\s*chamo|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,})/i,
  SOLO:  /^\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,})\s*$/i,
  HAIR:  /\b(liso|ondulado|cachead[oa]|crespo)\b/i,
};

const QUESTIONS = [
  { key:"hair_type", q:"Seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?" },
  { key:"had_prog_before", q:"Você já fez progressiva antes?" },
  { key:"goal", q:"Prefere resultado **bem liso** ou só **alinhado** e com menos frizz?" },
];

export default async function qualify(ctx) {
  const { jid, state, text="" } = ctx;
  state.turns = (state.turns||0)+1;

  // merge memória persistente
  const saved = await recall(jid);
  if (saved?.profile) state.profile = { ...(state.profile||{}), ...saved.profile };
  if (saved?.asked)   state.asked   = { ...(state.asked||{}), ...saved.asked   };

  // captura
  const s = String(text||"");
  const p = ensureProfile(state);
  if (!p.name) {
    const m = s.match(RX.NAME); if (m?.[2]) p.name = m[2].trim();
    const solo = s.match(RX.SOLO); if (solo?.[1]) p.name = solo[1].trim();
  }
  const hair = s.match(RX.HAIR);
  if (hair) p.hair_type = hair[1].toLowerCase();

  await remember(jid, { profile: state.profile, asked: state.asked });

  // próxima pergunta
  for (const q of QUESTIONS) {
    if (!isFilled(state, q.key)) {
      markAsked(state, q.key);
      await remember(jid, { asked: state.asked });
      const name = callUser(state);
      return tagReply({}, name ? `${name}, ${q.q}` : q.q, "flow/qualify");
    }
  }

  // tudo preenchido
  const itens = filledSummary(state);
  const rat = itens.length ? `Anotei: ${itens.join(" · ")}. Está correto?` : "Perfeito! Já consigo recomendar.";
  return tagReply({}, rat, "flow/qualify->offer");
}
