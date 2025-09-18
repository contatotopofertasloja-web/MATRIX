// configs/bots/claudia/flow/qualify.js
import { callUser, tagReply } from "./_state.js";

const RX_HAIR  = /\b(liso|ondulado|cachead[oa]|crespo)\b/i;
const RX_PRICE = /(preç|valor|quanto|cust)/i;
const RX_LINK  = /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho|pagamento)\b/i;

const QUESTIONS = [
  { key: "hair_type",       q: "Seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?" },
  { key: "had_prog_before", q: "Você já fez progressiva antes?" },
  { key: "goal",            q: "Prefere resultado **bem liso** ou só **alinhado** e com menos frizz?" },
];

function smartFill(state, text) {
  const m = String(text || "").toLowerCase().match(RX_HAIR);
  if (m && !state.hair_type) state.hair_type = m[1];
}
const nextQuestion = (s) => QUESTIONS.find(q => !s[q.key]);

export default async function qualify(ctx) {
  const { text = "", state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;

  // Saltos rápidos
  if (RX_LINK.test(text)) {
    state.link_allowed = true;
    return { reply: tagReply(settings, "Te envio o **link seguro** agora mesmo, tá? 💛", "flow/qualify"), next: "fechamento" };
  }
  if (RX_PRICE.test(text)) {
    state.price_allowed = true;
    return { reply: tagReply(settings, "Já te passo o valor e as condições 👌", "flow/qualify"), next: "oferta" };
  }

  // Slot-filling leve
  smartFill(state, text);

  const pending = nextQuestion(state);
  if (pending) {
    const tag = `__asked_${pending.key}_at`;
    const now = Date.now();
    if (!state[tag] || (now - state[tag]) > 45_000) {
      state[tag] = now;
      return { reply: tagReply(settings, pending.q, "flow/qualify"), next: "qualificacao" };
    }
    return { reply: tagReply(settings, "Me dá só essa info rapidinho pra eu te orientar certinho 😊", "flow/qualify"), next: "qualificacao" };
  }

  // Coletou o necessário → oferta
  return {
    reply: tagReply(settings, `Perfeito, ${callUser(state)}! Com base no que me disse, acho que já consigo te recomendar certinho.`, "flow/qualify"),
    next: "oferta",
  };
}
