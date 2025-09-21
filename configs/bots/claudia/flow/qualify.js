// configs/bots/claudia/flow/qualify.js
// Captura/uso de NOME + slot-filling (cabelo / já fez / objetivo) + atalhos (preço/link)
// Anti-loop com cooldown, "pular" e escalada para oferta
import { callUser, tagReply } from "./_state.js";

const RX = {
  NAME:  /\b(meu\s+nome\s+é|me\s+chamo|pode\s+me\s+chamar\s+de|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][^\d,.;!?]{2,30})/i,
  SOLO_NAME: /^\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,})\s*$/,

  HAIR:  /\b(liso|ondulado|cachead[oa]|crespo)\b/i,
  PRICE: /(preç|valor|quanto|cust)/i,
  LINK:  /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho|pagamento)\b/i,
  YES:   /\b(sim|já|ja fiz|fiz sim)\b/i,
  NO:    /\b(n[aã]o|nunca fiz|nunca)\b/i,

  SKIP:  /\bpular\b/i,
};

const QUESTIONS = [
  { key: "hair_type",       q: "Seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?" },
  { key: "had_prog_before", q: "Você já fez progressiva antes?" },
  { key: "goal",            q: "Prefere resultado **bem liso** ou só **alinhado** e com menos frizz?" },
];

// limites pra não “prender” a cliente nessa etapa
const COOLDOWN_MS = 60_000;
const MAX_TOUCHES_BEFORE_ESCALATE = 3;

/** Captura e grava nome no state.profile.name (compatível com callUser) */
function captureName(state, text = "") {
  const s = String(text || "").trim();
  if (!s) return;

  state.profile = state.profile || {};
  if (state.profile.name) return;

  const m = s.match(RX.NAME);
  if (m?.[2]) {
    state.profile.name = m[2].trim();
    return;
  }
  // se a pessoa enviar só o primeiro nome (ex.: "Ana")
  const solo = s.match(RX.SOLO_NAME);
  if (solo?.[1]) state.profile.name = solo[1].trim();
}

/** Slot-filling leve a partir do texto */
function smartFill(state, text = "") {
  const t = String(text || "").toLowerCase();

  const m = t.match(RX.HAIR);
  if (m && !state.hair_type) state.hair_type = m[1].toLowerCase();

  if (RX.YES.test(t) && state.had_prog_before == null) state.had_prog_before = true;
  if (RX.NO.test(t)  && state.had_prog_before == null) state.had_prog_before = false;

  // objetivo: heurística simples
  if (!state.goal) {
    if (/\bbem\s*liso\b/.test(t)) state.goal = "bem liso";
    else if (/\balinhad[oa]\b|\bmenos\s*frizz\b/.test(t)) state.goal = "alinhado/menos frizz";
  }
}

const nextQuestion = (s) => QUESTIONS.find(q => s[q.key] == null);

/** De vez em quando usa o nome pra aproximar sem ficar repetitivo */
function maybePrefixWithName(state, text, prob = 0.5) {
  const name = callUser(state);
  if (!name) return text;
  if (Math.random() >= prob) return text;
  // Evita duplicar cumprimento se já começou com "Oi"
  return text.replace(/^Oi[,!]?/i, `Oi, ${name}!`).replace(/^\s*$/, `Oi, ${name}!`);
}

export default async function qualify(ctx) {
  const { text = "", state, settings } = ctx;

  state.turns = (state.turns || 0) + 1;
  state.__qualify_hits = (state.__qualify_hits || 0) + 1;

  // 0) Captura nome (se informado nesta etapa)
  captureName(state, text);

  // 1) Atalhos diretos
  if (RX.LINK.test(text))  {
    state.link_allowed  = true;
    return { reply: tagReply(settings, "Te envio o **link seguro** agora 💛", "flow/qualify"), next: "fechamento" };
  }
  if (RX.PRICE.test(text)) {
    state.price_allowed = true;
    return { reply: tagReply(settings, "Já te passo o valor e condições 👌", "flow/qualify"), next: "oferta" };
  }

  // 2) Slot-filling leve
  smartFill(state, text);

  // 3) Se já temos informação suficiente, libera oferta
  if (state.hair_type && (state.had_prog_before !== null) && state.goal) {
    const msg = maybePrefixWithName(state, "Perfeito! Já consigo te recomendar certinho.");
    return { reply: tagReply(settings, msg, "flow/qualify"), next: "oferta" };
  }

  // 4) Pergunta guiada com anti-loop (cooldown + “pular” + escalada)
  const pending = nextQuestion(state);
  if (pending) {
    if (RX.SKIP.test(text)) {
      return { reply: tagReply(settings, "Fechado. Vou te mostrar a condição agora 👇", "flow/qualify"), next: "oferta" };
    }

    const flag = `__asked_${pending.key}_at`;
    const now  = Date.now();

    if (!state[flag] || (now - state[flag]) > COOLDOWN_MS) {
      state[flag] = now;
      const q = maybePrefixWithName(state, pending.q);
      return { reply: tagReply(settings, q, "flow/qualify"), next: "qualificacao" };
    }

    // cooldown ainda ativo → não repetir igual; dar escape + CTA
    const softNudge = pending.key === "hair_type"
      ? "Rapidinho: é **liso**, **ondulado**, **cacheado** ou **crespo**? 🙏 Se preferir, diga **pular** que eu já te
