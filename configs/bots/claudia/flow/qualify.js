// configs/bots/claudia/flow/qualify.js
// Slot-filling leve + pass-through. Nomes seguros, carimbos em todas respostas.

import {
  ensureProfile, ensureAsked, markAsked, isFilled,
  callUser, tagReply, filledSummary
} from "./_state.js";
import { remember, recall } from "../../../../src/core/memory.js";

const RX = {
  // aceita apenas nomes próprios, evita confundir com "alisar", "liso" etc.
  SOLO_NAME: /^(?!alisar$|liso$|ondulado$|cacheado$|crespo$|frizz$|volume$|brilho$)[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,}(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,})*$/,
  NAME_PREFIXED: /\b(meu\s*nome\s*é|me\s*chamo|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,})/i,
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

function TAG(text, id) { return { reply: tagReply({}, text, id), meta: { tag: id } }; }

export default async function qualify(ctx) {
  const { jid, state = {}, text = "" } = ctx;
  state.turns = (state.turns || 0) + 1;

  // memória
  const saved = await recall(jid).catch(() => null);
  if (saved?.profile) state.profile = { ...(state.profile || {}), ...saved.profile };
  if (saved?.asked) state.asked = { ...(state.asked || {}), ...saved.asked };

  const s = String(text || "").trim();
  const p = ensureProfile(state);

  // nome (prefixado ou solo seguro)
  const m = s.match(RX.NAME_PREFIXED); if (m?.[2]) p.name = m[2].trim();
  if (RX.SOLO_NAME.test(s)) p.name = s;

  // tipo de cabelo / objetivo
  const hair = s.match(RX.HAIR); if (hair) p.hair_type = hair[1].toLowerCase();
  const goal = s.match(RX.GOAL); if (goal) p.goal = (goal[1] || goal[0]).toLowerCase();

  // reset
  if (s.match(RX.EDIT)) {
    p.hair_type = null; p.goal = null; state.ratified = false;
    await remember(jid, { profile: state.profile, asked: state.asked, ratified: false });
    return TAG("Beleza, vamos recomeçar: seu cabelo é liso, ondulado, cacheado ou crespo?", "flow/qualify#reset");
  }

  await remember(jid, { profile: state.profile, asked: state.asked });

  // perguntas mínimas
  for (const q of QUESTIONS) {
    if (!isFilled(state, q.key)) {
      markAsked(state, q.key);
      await remember(jid, { asked: state.asked });
      const name = callUser(state);
      const msg = name ? `${name}, ${q.q}` : q.q;
      return TAG(msg, `flow/qualify#ask_${q.key}`);
    }
  }

  // ratificação
  if (!state.ratified) {
    const itens = filledSummary(state);
    const rat = itens.length ? `Anotei: ${itens.join(" · ")}. Está correto?` : "Perfeito! Já consigo recomendar.";
    state.ratified = true;
    await remember(jid, { profile: state.profile, asked: state.asked, ratified: true });
    return TAG(rat, "flow/qualify->ratify");
  }

  // resposta à ratificação → pass-through para offer
  if (s.match(RX.YES) || s.match(RX.CONFIRM)) {
    state.stage = "oferta";
    return TAG("Ótimo! Já te passo a condição do dia e verifico o COD no seu CEP 🙌", "flow/qualify→offer");
  }
  if (s.match(RX.NO)) {
    state.ratified = false;
    await remember(jid, { ratified: false });
    return TAG("Ok, me fala de novo então: qual é o tipo do seu cabelo?", "flow/qualify#reask_hair");
  }

  // nudge gentil
  return TAG("Só pra confirmar: seu cabelo é liso, ondulado, cacheado ou crespo?", "flow/nudge");
}
