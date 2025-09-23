// configs/bots/claudia/flow/qualify.js
// Etapa de qualificação: pega dados chave (nome, cabelo, já fez, objetivo).
// Evita loops com cooldown, dedupe e escalada para oferta.

import { callUser, tagReply } from "./_state.js";

const RX = {
  NAME: /\b(meu\s+nome\s+é|me\s+chamo|pode\s+me\s+chamar\s+de|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][^\d,.;!?]{2,30})/i,
  SOLO_NAME: /^\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúç]{2,})\s*$/,
  HAIR: /\b(liso|ondulado|cachead[oa]|crespo)\b/i,
  YES: /\b(sim|já|ja fiz|fiz sim)\b/i,
  NO: /\b(n[aã]o|nunca fiz|nunca)\b/i,
};

const QUESTIONS = [
  { key: "hair_type", q: "Seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?" },
  { key: "had_prog_before", q: "Você já fez progressiva antes?" },
  { key: "goal", q: "Prefere resultado **bem liso** ou só **alinhado** e com menos frizz?" },
];

const COOLDOWN_MS = 60_000;
const MAX_TOUCHES = 3;
const DEDUPE_MS = 5_000;

function captureName(state, text = "") {
  const s = String(text || "").trim();
  if (!s) return;
  state.profile = state.profile || {};
  if (!state.profile.name) {
    const m = s.match(RX.NAME) || s.match(RX.SOLO_NAME);
    if (m?.[2] || m?.[1]) state.profile.name = (m[2] || m[1]).trim();
  }
}

function captureHair(state, text = "") {
  const m = String(text || "").match(RX.HAIR);
  if (m) state.profile.hair_type = m[1].toLowerCase();
}

export default async function qualify(ctx) {
  const { state, text } = ctx;
  state.turns = (state.turns || 0) + 1;
  state.profile = state.profile || {};

  captureName(state, text);
  captureHair(state, text);

  // Se já preencheu slots, avança
  if (state.profile.hair_type && state.profile.had_prog_before && state.profile.goal) {
    return "Perfeito 💕, já entendi bastante sobre você. Quer que eu te mostre uma oferta especial hoje?";
  }

  // Evita rajada
  const now = Date.now();
  if (state.__lastQ && now - state.__lastQ < DEDUPE_MS) return null;
  state.__lastQ = now;

  // Escolhe próxima pergunta
  for (const q of QUESTIONS) {
    if (!state.profile[q.key]) {
      return state.profile.name
        ? `*${state.profile.name}*, ${q.q} (flow/qualify)`
        : `${q.q} (flow/qualify)`;
    }
  }

  // fallback
  return "Só pra confirmar: você busca um cabelo bem liso ou só alinhado? (flow/qualify)";
}
