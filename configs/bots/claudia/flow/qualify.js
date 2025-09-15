// configs/bots/claudia/flow/qualify.js
// Slot-filling de qualificação. Não repete pergunta já respondida e
// salta para oferta quando pedir valor/link/comprar.

import { callUser } from "./_state.js";

const RX_HAIR = /\b(liso|ondulado|cachead[oa]|crespo)\b/i;
const RX_PRICE = /(preç|valor|quanto|cust)/i;
const RX_LINK  = /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho)\b/i;

const QUESTIONS = [
  { key: "hair_type", q: "Seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?" },
  { key: "had_prog_before", q: "Você já fez progressiva antes?" },
  { key: "goal", q: "Prefere resultado **bem liso** ou só **alinhado** e com menos frizz?" },
];

function smartFill(state, text) {
  const m = String(text || "").toLowerCase().match(RX_HAIR);
  if (m && !state.hair_type) state.hair_type = m[1];
}

function nextQuestion(state) {
  return QUESTIONS.find(q => !state[q.key]);
}

export default async function qualify(ctx) {
  const { text = "", state } = ctx;
  state.turns = (state.turns || 0) + 1;

  // Se pediu preço ou link, pula pra oferta/fechamento
  if (RX_LINK.test(text)) {
    state.link_allowed = true;
    return { reply: "Posso te enviar o **link seguro do checkout** agora mesmo. Quer receber?", next: "fechamento" };
  }
  if (RX_PRICE.test(text)) {
    state.price_allowed = true;
    return { reply: "Já te passo o valor e as condições 👌", next: "oferta" };
  }

  // Preenchimento automático
  smartFill(state, text);

  const pending = nextQuestion(state);
  if (pending) {
    const tag = `__asked_${pending.key}_at`;
    const now = Date.now();
    if (!state[tag] || (now - state[tag]) > 45_000) {
      state[tag] = now;
      return { reply: pending.q, next: "qualificacao" };
    }
    return { reply: "Me dá só essa informação rapidinho pra eu te orientar certinho 😊", next: "qualificacao" };
  }

  // Tudo coletado → encaminha para oferta consultiva
  const nome = callUser(state);
  const sum = `Entendi, ${nome}! Vou te sugerir a melhor forma de uso e te falo do valor.`;
  return { reply: sum, next: "oferta" };
}
