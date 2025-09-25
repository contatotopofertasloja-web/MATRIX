// configs/bots/claudia/flow/qualify.js
// Slot-filling com memória: NÃO repete perguntas já respondidas; ratifica o que já tem.
// Inclui comando de auditoria: /memoria, /memória ou /memory

import {
  remember, recall, ensureProfile, ensureAsked, markAsked, isFilled,
  callUser, tagReply, normalizeSettings, filledSummary, formatAudit
} from "./_state.js";

const RX = {
  NAME:  /\b(meu\s*nome\s*é|me\s*chamo|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,})/i,
  SOLO:  /^\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,})\s*$/,
  HAIR:  /\b(liso|ondulado|cachead[oa]|crespo)\b/i,
  YES:   /\b(sim|já|ja fiz|fiz sim)\b/i,
  NO:    /\b(n[aã]o|nunca fiz|nunca)\b/i,
  GOAL_LISO: /\bbem\s*liso\b/i,
  GOAL_ALIN: /\balinhad[oa]\b|\bmenos\s*frizz\b/i,

  WANT_STORE:   /\b(nome|qual)\s+(da|de)\s+(loja|empresa)\b/i,
  WANT_PRODUCT: /\b(nome|qual)\s+(do|da)\s+(produto|progressiva)\b/i,
  WANT_HOURS:   /\b(hor[aá]rio|funcionamento|atendimento)\b/i,

  CONFIRM: /\b(confirma|confirmar|t[áa]\s*certo|ok|isso mesmo|isso)\b/i,
  EDIT:    /\b(mudar|trocar|na verdade|corrig|err(ei|o))\b/i,

  AUDIT:   /^\/(memoria|memória|memory)\b/i,
};

const QUESTIONS = [
  { key: "hair_type",       q: "Seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?" },
  { key: "had_prog_before", q: "Você já fez progressiva antes?" },
  { key: "goal",            q: "Prefere resultado **bem liso** ou só **alinhado** e com menos frizz?" },
];

const COOLDOWN_MS = 60_000;   // 1 min entre a MESMA pergunta
const NUDGE_MS    = 15_000;   // nudge sem repetir igual
const MAX_TOUCHES = 3;        // depois disso, avança

function captureAll(state, text = "") {
  const s = String(text || "");
  const p = ensureProfile(state);

  // nome
  if (!p.name) {
    const m = s.match(RX.NAME);
    if (m?.[2]) p.name = m[2].trim();
    else {
      const solo = s.match(RX.SOLO);
      if (solo?.[1]) p.name = solo[1].trim();
    }
  }

  // cabelo
  const hair = s.match(RX.HAIR);
  if (hair) p.hair_type = hair[1].toLowerCase();

  // já fez?
  if (RX.YES.test(s) && p.had_prog_before == null) p.had_prog_before = true;
  if (RX.NO.test(s)  && p.had_prog_before == null) p.had_prog_before = false;

  // objetivo
  if (!p.goal) {
    if (RX.GOAL_LISO.test(s)) p.goal = "bem liso";
    else if (RX.GOAL_ALIN.test(s)) p.goal = "alinhado/menos frizz";
  }
}

function nextMissing(state) {
  const p = ensureProfile(state);
  for (const q of QUESTIONS) if (!isFilled(state, q.key)) return q;
  return null;
}

function buildRatify(state) {
  const itens = filledSummary(state);
  if (!itens.length) return "";
  return `Anotei: ${itens.join(" · ")}. Está correto?`;
}

export default async function qualify(ctx) {
  const { jid, state, text = "", settings } = ctx;
  const S = normalizeSettings(settings);
  state.turns = (state.turns || 0) + 1;

  // Auditoria (comando)
  if (RX.AUDIT.test(text)) {
    const audit = formatAudit(state);
    return tagReply(S, audit, "flow/qualify#audit");
  }

  // merge com memória (flow store)
  const saved = await recall(jid);
  if (saved?.profile) state.profile = { ...(state.profile || {}), ...saved.profile };
  if (saved?.asked)   state.asked   = { ...(state.asked   || {}), ...saved.asked   };

  // captura do turno
  captureAll(state, text);
  await remember(jid, { profile: state.profile });

  // atalhos informativos
  if (RX.WANT_STORE.test(text)) {
    return tagReply(S, `A loja é a *${S.product.store_name}*.`, "flow/qualify");
  }
  if (RX.WANT_PRODUCT.test(text)) {
    return tagReply(S, `O produto é a *${S.product.name}*.`, "flow/qualify");
  }
  if (RX.WANT_HOURS.test(text)) {
    return tagReply(S, `Atendemos ${S.product.opening_hours}.`, "flow/qualify");
  }

  // edição/correção
  if (RX.EDIT.test(text)) {
    const rat = buildRatify(state);
    return tagReply(S, `${rat || "Me diga o correto e eu atualizo aqui."}`, "flow/qualify");
  }

  // Se está completo → ratifica e avança
  const missing = nextMissing(state);
  if (!missing) {
    const rat = buildRatify(state);
    const msg = rat ? `${rat} Se quiser, já te mostro a condição.` : "Perfeito! Já consigo te recomendar certinho.";
    return tagReply(S, msg, "flow/qualify->offer");
  }

  // NÃO repetir pergunta: cooldown + nudges
  const asked = ensureAsked(state)[missing.key];
  const now = Date.now();

  if (!asked) {
    // primeira vez
    markAsked(state, missing.key);
    await remember(jid, { asked: state.asked });
    const name = callUser(state);
    const q = name ? `${name}, ${missing.q}` : missing.q;
    return tagReply(S, q, "flow/qualify");
  }

  const elapsed = now - (asked.at || 0);

  // confirmação do tipo “ok/isso”
  if (RX.CONFIRM.test(text)) {
    const rat = buildRatify(state);
    return tagReply(S, rat || "Anotado! Posso seguir?", "flow/qualify");
  }

  // curto prazo → nudge sem repetir
  if (elapsed < NUDGE_MS) {
    return tagReply(
      S,
      missing.key === "hair_type"
        ? "Rapidinho: é **liso**, **ondulado**, **cacheado** ou **crespo**?"
        : "Me diz isso e eu já te passo o valor/link ✨",
      "flow/qualify"
    );
  }

  // dentro do cooldown → oferece pular
  if (elapsed < COOLDOWN_MS) {
    return tagReply(S, "Se preferir, posso **pular isso** e já te mostrar a condição.", "flow/qualify");
  }

  // passou cooldown → reformula (conta toques)
  if ((asked.count || 0) < MAX_TOUCHES) {
    markAsked(state, missing.key);
    await remember(jid, { asked: state.asked });
    const reform = missing.key === "had_prog_before"
      ? "Você **já fez progressiva** alguma vez?"
      : (missing.key === "goal"
          ? "Quer resultado **bem liso** ou **alinhado** com menos frizz?"
          : "Seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?");
    return tagReply(S, reform, "flow/qualify");
  }

  // excedeu toques → avança
  const rat = buildRatify(state);
  const msg = rat
    ? `${rat} Com isso eu já consigo te recomendar certinho 👇`
    : "Com o que já tenho, consigo te recomendar certinho 👇";
  return tagReply(S, msg, "flow/qualify->offer");
}
