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

  // Atalhos
  if (RX.LINK.test(text))  { state.link_allowed  = true; return { reply: tagReply(settings, "Te envio o **link seguro** agora 💛", "flow/qualify"), next: "fechamento" }; }
  if (RX.PRICE.test(text)) { state.price_allowed = true; return { reply: tagReply(settings, "Já te passo o valor e condições 👌", "flow/qualify"), next: "oferta" }; }

  // Slot-filling leve
  smartFill(state, String(text || "").toLowerCase());

  const pending = nextQuestion(state);
  if (pending) {
    const flag = `__asked_${pending.key}_at`;
    const now  = Date.now();
    if (!state[flag] || (now - state[flag]) > 60_000) {
      state[flag] = now;
      return { reply: tagReply(settings, pending.q, "flow/qualify"), next: "qualificacao" };
    }
    return { reply: tagReply(settings, "Me dá só essa info pra eu te orientar certinho 😊", "flow/qualify"), next: "qualificacao" };
  }

  // Pronto para oferta
  return {
    reply: tagReply(settings, `Perfeito, ${callUser(state)}! Já consigo te recomendar certinho.`, "flow/qualify"),
    next: "oferta",
  };
}
