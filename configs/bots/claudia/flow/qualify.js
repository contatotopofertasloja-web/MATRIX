// configs/bots/claudia/flow/qualify.js
// Slot-filling com memória persistente + auditoria + atalhos + nudges

import {
  ensureProfile, ensureAsked, markAsked, isFilled,
  callUser, tagReply, filledSummary
} from "./_state.js";
import { remember, recall } from "../../../../src/core/memory.js";

const RX = {
  NAME: /\b(meu\s*nome\s*é|me\s*chamo|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,})/i,
  SOLO: /^\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,})\s*$/i,
  HAIR: /\b(liso|ondulado|cachead[oa]|crespo)\b/i,
  YES: /\b(sim|claro|ok|isso|positivo)\b/i,
  NO: /\b(não|nao|negativo|errado|nop)\b/i,
  EDIT: /\b(mudar|trocar|corrigir|na verdade)\b/i,
  CONFIRM: /\b(certo|correto|isso mesmo|perfeito)\b/i,
};

const QUESTIONS = [
  { key: "hair_type", q: "Seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?" },
  { key: "had_prog_before", q: "Você já fez progressiva antes?" },
  { key: "goal", q: "Prefere resultado **bem liso** ou só **alinhado** e com menos frizz?" },
];

const NUDGE_MS = 30000;
const COOLDOWN_MS = 10000;
const MAX_TOUCHES = 6;

export default async function qualify(ctx) {
  const { jid, state, text = "" } = ctx;
  state.turns = (state.turns || 0) + 1;

  // carrega memória persistente
  const saved = await recall(jid);
  if (saved?.profile) state.profile = { ...(state.profile || {}), ...saved.profile };
  if (saved?.asked) state.asked = { ...(state.asked || {}), ...saved.asked };

  const s = String(text || "");
  const p = ensureProfile(state);

  // comandos especiais
  if (/^\/memoria/i.test(s)) {
    return tagReply({}, "📒 Memória: " + JSON.stringify(state.profile || {}, null, 2), "audit");
  }
  if (/^\/memory/i.test(s)) {
    return tagReply({}, "📒 State: " + JSON.stringify(state || {}, null, 2), "audit");
  }

  // atalhos
  if (/loja|nome da loja/i.test(s)) {
    return tagReply({}, `O nome da loja é *${ctx.settings?.product?.store_name || "nossa loja"}*.`, "flow/qualify");
  }
  if (/hor(a|ário)/i.test(s)) {
    return tagReply({}, `Nosso horário de atendimento é ${ctx.settings?.product?.opening_hours || "das 8h às 20h"}.`, "flow/qualify");
  }

  // captura de nome
  if (!p.name) {
    const m = s.match(RX.NAME);
    if (m?.[2]) p.name = m[2].trim();
    const solo = s.match(RX.SOLO);
    if (solo?.[1]) p.name = solo[1].trim();
  }

  // captura cabelo
  const hair = s.match(RX.HAIR);
  if (hair) p.hair_type = hair[1].toLowerCase();

  // edição/correção
  if (s.match(RX.EDIT)) {
    p.hair_type = null;
    p.goal = null;
    return tagReply({}, "Beleza, vamos recomeçar: qual é o tipo do seu cabelo?", "flow/qualify");
  }

  await remember(jid, { profile: state.profile, asked: state.asked });

  // checa preenchimento
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
    const rat = itens.length
      ? `Anotei: ${itens.join(" · ")}. Está correto?`
      : "Perfeito! Já consigo recomendar.";
    state.ratified = true;
    await remember(jid, { profile: state.profile, asked: state.asked, ratified: true });
    return tagReply({}, rat, "flow/qualify->ratify");
  }

  // resposta à ratificação
  if (s.match(RX.YES) || s.match(RX.CONFIRM)) {
    return tagReply({}, "Ótimo, bora prosseguir!", "flow/qualify->offer");
  }
  if (s.match(RX.NO)) {
    state.ratified = false;
    await remember(jid, { ratified: false });
    return tagReply({}, "Ok, me fala de novo então: qual é o tipo do seu cabelo?", "flow/qualify");
  }

  // nudge/cooldown
  const last = Object.values(state.asked || {}).pop();
  if (last && Date.now() - last.at > NUDGE_MS && state.turns < MAX_TOUCHES) {
    return tagReply({}, "Só pra confirmar: seu cabelo é liso, ondulado, cacheado ou crespo?", "flow/nudge");
  }

  return "";
}
