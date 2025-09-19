// configs/bots/claudia/flow/qualify.js
import { callUser, tagReply } from "./_state.js";

const RX = {
  HAIR:  /\b(liso|ondulado|cachead[oa]|crespo)\b/i,
  PRICE: /(preç|valor|quanto|cust)/i,
  LINK:  /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho|pagamento)\b/i,
  YES:   /\b(sim|já|ja fiz|fiz sim)\b/i,
  NO:    /\b(n[aã]o|nunca fiz|nunca)\b/i,
};

const QUESTIONS = [
  { key: "hair_type",       q: "Seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?" },
  { key: "had_prog_before", q: "Você já fez progressiva antes?" },
  { key: "goal",            q: "Prefere resultado **bem liso** ou só **alinhado** e com menos frizz?" },
];

// limites pra não “prender” a cliente nessa etapa
const COOLDOWN_MS = 60_000;
const MAX_TOUCHES_BEFORE_ESCALATE = 3;

function smartFill(state, text = "") {
  const m = text.match(RX.HAIR);
  if (m && !state.hair_type) state.hair_type = m[1].toLowerCase();
  if (RX.YES.test(text) && state.had_prog_before === null) state.had_prog_before = true;
  if (RX.NO.test(text)  && state.had_prog_before === null) state.had_prog_before = false;
}
const nextQuestion = (s) => QUESTIONS.find(q => s[q.key] == null);

export default async function qualify(ctx) {
  const { text = "", state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;
  state.__qualify_hits = (state.__qualify_hits || 0) + 1;

  // Atalhos diretos
  if (RX.LINK.test(text))  { state.link_allowed  = true; return { reply: tagReply(settings, "Te envio o **link seguro** agora 💛", "flow/qualify"), next: "fechamento" }; }
  if (RX.PRICE.test(text)) { state.price_allowed = true; return { reply: tagReply(settings, "Já te passo o valor e condições 👌", "flow/qualify"), next: "oferta" }; }

  // Slot-filling leve
  smartFill(state, String(text || "").toLowerCase());

  // Se já temos informação suficiente, libera oferta
  if (state.hair_type && (state.had_prog_before !== null) && state.goal) {
    return {
      reply: tagReply(settings, `Perfeito, ${callUser(state)}! Já consigo te recomendar certinho.`, "flow/qualify"),
      next: "oferta",
    };
  }

  // Pergunta guiada com anti-loop (cooldown + variação)
  const pending = nextQuestion(state);
  if (pending) {
    const flag = `__asked_${pending.key}_at`;
    const now  = Date.now();

    if (!state[flag] || (now - state[flag]) > COOLDOWN_MS) {
      state[flag] = now;
      return { reply: tagReply(settings, pending.q, "flow/qualify"), next: "qualificacao" };
    }

    // cooldown ainda ativo → não repetir igual; dar escape + CTA
    const softNudge = pending.key === "hair_type"
      ? "Rapidinho: é **liso**, **ondulado**, **cacheado** ou **crespo**? 🙏 Se preferir, diga **pular** que eu já te passo o valor."
      : "Me diz isso e já te mostro o valor/link ✨ (ou diga **pular** que eu te recomendo direto).";

    // Se a pessoa disser “pular”, forçamos avanço para oferta
    if (/\bpular\b/i.test(text)) {
      return { reply: tagReply(settings, "Fechado. Vou te mostrar a condição agora 👇", "flow/qualify"), next: "oferta" };
    }

    // Evitar ficar presa pra sempre: após X toques, escala mesmo sem resposta perfeita
    if (state.__qualify_hits >= MAX_TOUCHES_BEFORE_ESCALATE) {
      return { reply: tagReply(settings, "Com o que já tenho, consigo te passar a condição 👇", "flow/qualify"), next: "oferta" };
    }

    return { reply: tagReply(settings, softNudge, "flow/qualify"), next: "qualificacao" };
  }

  // fallback: recomenda e segue
  return {
    reply: tagReply(settings, `Perfeito, ${callUser(state)}! Já consigo te recomendar certinho.`, "flow/qualify"),
    next: "oferta",
  };
}
