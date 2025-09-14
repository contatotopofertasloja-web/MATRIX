// configs/bots/claudia/flow/close.js
import { callUser, summarizeAddress } from "./_state.js";

const ASK_ORDER = [
  { key: "telefone",     q: "Pra agilizar seu **COD**, me informa seu *telefone* com DDD?" },
  { key: "cep",          q: "Qual o seu **CEP**?" },
  { key: "rua",          q: "Rua/avenida?" },
  { key: "numero",       q: "Número?" },
  { key: "complemento",  q: "Complemento (se tiver)?" },
  { key: "bairro",       q: "Bairro?" },
  { key: "cidade",       q: "Cidade?" },
  { key: "uf",           q: "Estado (UF)?" },
  { key: "referencia",   q: "Um ponto de referência ajuda a entrega 😉" },
];

function nextMissing(state) {
  return ASK_ORDER.find(i => !state[i.key]);
}

export default async function close(ctx) {
  const { state } = ctx;

  const miss = nextMissing(state);
  if (miss) {
    return { reply: `${miss.q}`, next: "fechamento" };
  }

  // resumo e consentimento
  if (!state.consent_checkout) {
    const resumo = summarizeAddress(state);
    return {
      reply:
        `Confere pra mim, ${callUser(state)}:\n` +
        `• Telefone: ${state.telefone}\n` +
        `• Endereço: ${resumo}\n\n` +
        `Posso **gerar seu pedido no COD** com esses dados? (sim/não)\n` +
        `Você recebe antes e paga só na entrega 💛`,
      next: "fechamento",
    };
  }

  // pronto para gerar pedido (modo concierge: sem link)
  return {
    reply:
      `Perfeito! Já deixei **seu pedido no COD preparado** ✅\n` +
      `Você vai receber as atualizações por aqui. Qualquer dúvida, tô pertinho de você 💖`,
    next: "posvenda",
  };
}
