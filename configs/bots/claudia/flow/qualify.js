// configs/bots/claudia/flow/qualify.js
// Slot-filling leve para não travar o funil. Mantém memória e carimbo.
// Se já tiver sinais suficientes, direciona para offer (pass-through).

import {
  ensureProfile, ensureAsked, markAsked, isFilled,
  callUser, tagReply, filledSummary
} from "./_state.js";
import { remember, recall } from "../../../../src/core/memory.js";

const RX = {
  NAME: /\b(meu\s*nome\s*é|me\s*chamo|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,})/i,
  SOLO: /^\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,})\s*$/i,
  HAIR: /\b(liso|ondulado|cachead[oa]|crespo)\b/i,
  GOAL: /\b(frizz|volume|brilho|alisar|liso|chapar)\b/i,
  YES: /\b(sim|claro|ok|isso|positivo)\b/i,
  NO: /\b(não|nao|negativo|errado|nop)\b/i,
  EDIT: /\b(mudar|trocar|corrigir|na verdade)\b/i,
  CONFIRM: /\b(certo|correto|isso mesmo|perfeito)\b/i,
};

const QUESTIONS = [
  { key: "hair_type", q: "Seu cabelo é liso, ondulado, cacheado ou crespo?" },
  { key: "had_prog_before", q: "Você já fez progressiva antes?" },
  { key: "goal", q: "Prefere resultado bem liso ou mais alinhado com menos frizz?" },
];

export default async function qualify(ctx) {
  const { jid, state = {}, text = "" } = ctx;
  state.turns = (state.turns || 0) + 1;

  // memória
  const saved = await recall(jid);
  if (saved?.profile) state.profile = { ...(state.profile || {}), ...saved.profile };
  if (saved?.asked) state.asked = { ...(state.asked || {}), ...saved.asked };

  const s = String(text || "");
  const p = ensureProfile(state);

  // atalhos: captura nome/ cabelo/ objetivo
  const m = s.match(RX.NAME); if (m?.[2]) p.name = m[2].trim();
  const solo = s.match(RX.SOLO); if (solo?.[1]) p.name = solo[1].trim();
  const hair = s.match(RX.HAIR); if (hair) p.hair_type = hair[1].toLowerCase();
  const goal = s.match(RX.GOAL); if (goal) p.goal = (goal[1] || goal[0]).toLowerCase();

  // reset
  if (s.match(RX.EDIT)) {
    p.hair_type = null; p.goal = null; state.ratified = false;
    await remember(jid, { profile: state.profile, asked: state.asked, ratified: false });
    return tagReply({}, "Beleza, vamos recomeçar: seu cabelo é liso, ondulado, cacheado ou crespo?", "flow/qualify");
  }

  await remember(jid, { profile: state.profile, asked: state.asked });

  // perguntas mínimas
  for (const q of QUESTIONS) {
    if (!isFilled(state, q.key)) {
      markAsked(state, q.key);
      await remember(jid, { asked: state.asked });
      const name = callUser(state);
      return tagReply({}, name ? `${name}, ${q.q}` : q.q, "flow/qualify");
    }
  }

  // ratificação
  if (!state.ratified) {
    const itens = filledSummary(state);
    const rat = itens.length ? `Anotei: ${itens.join(" · ")}. Está correto?` : "Perfeito! Já consigo recomendar.";
    state.ratified = true;
    await remember(jid, { profile: state.profile, asked: state.asked, ratified: true });
    return tagReply({}, rat, "flow/qualify->ratify");
  }

  // resposta à ratificação → pass-through para offer
  if (s.match(RX.YES) || s.match(RX.CONFIRM)) {
    state.stage = "oferta";
    return tagReply({}, "Ótimo! Já te passo a condição do dia e verifico o COD no seu CEP 🙌", "flow/qualify→offer");
  }
  if (s.match(RX.NO)) {
    state.ratified = false;
    await remember(jid, { ratified: false });
    return tagReply({}, "Ok, me fala de novo então: qual é o tipo do seu cabelo?", "flow/qualify");
  }

  // nudge gentil
  return tagReply({}, "Só pra confirmar: seu cabelo é liso, ondulado, cacheado ou crespo?", "flow/nudge");
}
