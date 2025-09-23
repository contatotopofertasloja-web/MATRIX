// configs/bots/claudia/flow/qualify.js
// Qualificação com slot-filling + anti-loop + avanço forçado pra oferta.

import { remember, recall, ensureProfile, callUser, tagReply, normalizeSettings } from "./_state.js";

const RX = {
  NAME:  /\b(meu\s*nome\s*é|me\s*chamo|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,})/i,
  SOLO:  /^\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,})\s*$/,
  HAIR:  /\b(liso|ondulado|cachead[oa]|crespo)\b/i,
  YES:   /\b(sim|já|ja fiz|fiz sim)\b/i,
  NO:    /\b(n[aã]o|nunca fiz|nunca)\b/i,
  GOAL_LISO: /\bbem\s*liso\b/i,
  GOAL_ALIN: /\balinhad[oa]\b|\bmenos\s*frizz\b/i,
  SKIP:  /\bpular\b/i,

  WANT_STORE: /\b(nome|qual)\s+(da|de)\s+(loja|empresa)\b/i,
  WANT_PRODUCT: /\b(nome|qual)\s+(do|da)\s+(produto|progressiva)\b/i,
  WANT_HOURS: /\b(hor[aá]rio|funcionamento|atendimento)\b/i,
};

const QUESTIONS = [
  { key: "hair_type",       q: "Seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?" },
  { key: "had_prog_before", q: "Você já fez progressiva antes?" },
  { key: "goal",            q: "Prefere resultado **bem liso** ou só **alinhado** e com menos frizz?" },
];

const COOLDOWN_MS = 60_000;
const DEDUPE_MS   = 5_000;
const MAX_HITS    = 3;

function captureAll(state, text = "") {
  const s = String(text);
  const p = ensureProfile(state);

  // Nome
  if (!p.name) {
    const m = s.match(RX.NAME);
    if (m?.[2]) p.name = m[2].trim();
    else {
      const solo = s.match(RX.SOLO);
      if (solo?.[1]) p.name = solo[1].trim();
    }
  }
  // Cabelo
  const h = s.match(RX.HAIR);
  if (h) p.hair_type = h[1].toLowerCase();

  // Já fez?
  if (RX.YES.test(s) && p.had_prog_before == null) p.had_prog_before = true;
  if (RX.NO.test(s)  && p.had_prog_before == null) p.had_prog_before = false;

  // Objetivo
  if (!p.goal) {
    if (RX.GOAL_LISO.test(s)) p.goal = "bem liso";
    else if (RX.GOAL_ALIN.test(s)) p.goal = "alinhado/menos frizz";
  }
}

function nextQuestion(p) {
  for (const q of QUESTIONS) if (p[q.key] == null) return q;
  return null;
}

export default async function qualify(ctx) {
  const { jid, state, text, settings } = ctx;
  const S = normalizeSettings(settings);
  state.turns = (state.turns || 0) + 1;
  state.__qualify_hits = (state.__qualify_hits || 0) + 1;

  // merge com memória
  const saved = await recall(jid);
  if (saved?.profile) state.profile = { ...(state.profile || {}), ...saved.profile };

  // captura do turno
  captureAll(state, text);
  await remember(jid, { profile: state.profile });

  // atalhos informativos (loja/produto/horário)
  if (RX.WANT_STORE.test(text || "")) {
    const reply = `A loja é a *${S.product.store_name}*. Precisa de algo específico?`;
    return tagReply(S, reply, "flow/qualify");
  }
  if (RX.WANT_PRODUCT.test(text || "")) {
    const reply = `O produto é a *${S.product.name}*. Posso te explicar como usar e o que ele resolve.`;
    return tagReply(S, reply, "flow/qualify");
  }
  if (RX.WANT_HOURS.test(text || "")) {
    const reply = `Atendemos ${S.product.opening_hours}. Quer que eu já te passe a condição?`;
    return tagReply(S, reply, "flow/qualify");
  }

  // Se já temos informação suficiente → oferta
  const p = ensureProfile(state);
  if (p.hair_type && p.goal && p.had_prog_before != null) {
    const msg = callUser(state)
      ? `Perfeito, ${callUser(state)}! Com isso eu já consigo te recomendar certinho.`
      : `Perfeito! Com isso eu já consigo te recomendar certinho.`;
    return tagReply(S, msg, "flow/qualify->offer");
  }

  // Anti-loop: cooldown / dedupe / avanço forçado
  const now = Date.now();
  const pending = nextQuestion(p);

  if (pending) {
    if (RX.SKIP.test(text || "")) {
      const msg = "Fechado. Posso te mostrar a condição agora 👇";
      return tagReply(S, msg, "flow/qualify->offer");
    }

    if (state.__last_q_key === pending.key && (now - (state.__last_q_at || 0)) < DEDUPE_MS) {
      // não repete a mesma pergunta em sequência curtíssima
      return null;
    }

    // cooldown da pergunta
    const stamp = `__asked_${pending.key}_at`;
    if (!state[stamp] || (now - state[stamp]) > COOLDOWN_MS) {
      state[stamp] = now;
      state.__last_q_key = pending.key;
      state.__last_q_at = now;

      const name = callUser(state);
      const q = name ? `${name}, ${pending.q}` : pending.q;
      return tagReply(S, q, "flow/qualify");
    }

    // atingiu hits → força avançar
    if (state.__qualify_hits >= MAX_HITS) {
      const msg = "Com o que já tenho, consigo te passar a condição 👇";
      return tagReply(S, msg, "flow/qualify->offer");
    }

    // empurra um empurrão suave
    const nudge = pending.key === "hair_type"
      ? "Rapidinho: é **liso**, **ondulado**, **cacheado** ou **crespo**? Se preferir, diga **pular**."
      : "Me diz isso e já te mostro o valor/link ✨ (ou diga **pular**).";
    return tagReply(S, nudge, "flow/qualify");
  }

  // fallback
  const ok = callUser(state)
    ? `Perfeito, ${callUser(state)}! Já consigo te recomendar certinho.`
    : "Perfeito! Já consigo te recomendar certinho.";
  return tagReply(S, ok, "flow/qualify->offer");
}
