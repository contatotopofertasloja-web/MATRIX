// configs/bots/claudia/flow/close.js
import { callUser, summarizeAddress } from "./_state.js";

// Ordem de coleta (concierge COD)
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

// ----------------------
// Parsing “esperto”
// ----------------------
const RX = {
  telefone: /(?:\b(?:tel|telefone|cel|whats?)\b[: ]*)?(\+?55)?\s*\(?(?<ddd>\d{2})\)?\s*(?<p1>\d{4,5})[-.\s]?(?<p2>\d{4})/i,
  cep: /\b(?<cep>\d{5})[-.\s]?(?<suf>\d{3})\b/,
  numero: /\b(?<num>\d{1,6})(?:\s*(?:n[oº]|numero|número))?\b/i,
  uf: /\b(?<uf>[A-Z]{2})\b/,
};

// tenta preencher campos a partir do texto livre
function smartFill(state, textRaw) {
  const text = String(textRaw || "").trim();
  if (!text) return;

  // telefone
  if (!state.telefone) {
    const m = text.match(RX.telefone);
    if (m) state.telefone = `(${m.groups.ddd}) ${m.groups.p1}-${m.groups.p2}`;
  }
  // cep
  if (!state.cep) {
    const m = text.match(RX.cep);
    if (m) state.cep = `${m.groups.cep}-${m.groups.suf}`;
  }
  // número
  if (!state.numero) {
    const m = text.match(RX.numero);
    if (m) state.numero = m.groups.num;
  }
  // UF (só aceita se vier duas letras)
  if (!state.uf) {
    const m = text.toUpperCase().match(RX.uf);
    if (m) state.uf = m.groups.uf;
  }

  // heurísticas simples para rua/bairro/cidade/complemento/referência
  // (usuária costuma escrever "Rua X, 123 - Centro - Cidade/UF")
  if (!state.rua) {
    const ruaMatch = text.match(/(?:rua|av\.?|avenida|travessa|alameda)\s+([^,|\n]+)/i);
    if (ruaMatch) state.rua = ruaMatch[0].trim();
  }
  if (!state.bairro) {
    const b = text.match(/\b(bairro|jd\.?|jardim|centro|vila)\b[^,\n]*/i);
    if (b) state.bairro = b[0].replace(/^(bairro\s*)/i, "").trim();
  }
  if (!state.cidade) {
    const cid = text.match(/\b(cidade|munic[ií]pio)\b[: ]*([A-Za-zÀ-ú' ]{3,})/i);
    if (cid) state.cidade = cid[2].trim();
  }
  if (!state.complemento) {
    const comp = text.match(/\b(apto|ap|bloco|bl|fundos|casa\s*\d+|casa|sobrado|edif[ií]cio)\b[^,\n]*/i);
    if (comp) state.complemento = comp[0].trim();
  }
  if (!state.referencia) {
    const ref = text.match(/\b(refer[eê]ncia|perto de|ao lado de)\b[^.\n]*/i);
    if (ref) state.referencia = ref[0].replace(/^refer[eê]ncia[: ]*/i, "").trim();
  }
}

function nextMissing(state) {
  return ASK_ORDER.find(i => !state[i.key]);
}

// normaliza confirmação
function isYes(text = "") {
  return /\b(sim|pode|ok|okay|confirmo|confirmada|t[aã]\s*bom|t[aã]\s*ótimo|isso|fechar|manda)\b|👍|✔|✅/i.test(text);
}
function isNo(text = "") {
  return /\b(n[aã]o|negativo|pera|espera|calma|corrigir|editar|mudar|alterar)\b|👎/i.test(text);
}

export default async function close(ctx) {
  const { state, text = "" } = ctx;

  // primeiro, tenta preencher automaticamente com o que a cliente digitou
  smartFill(state, text);

  // se ainda tem campos faltando, pergunta o próximo
  let miss = nextMissing(state);
  if (miss) {
    return { reply: `${miss.q}`, next: "fechamento" };
  }

  // resumo e consentimento
  if (!state.consent_checkout) {
    // Se a cliente respondeu "sim/não" ANTES de ver o resumo, respeita.
    if (text && isYes(text)) {
      state.consent_checkout = true;
    } else if (text && isNo(text)) {
      return {
        reply:
          `Claro, ${callUser(state)}! Qual **dado** você quer corrigir? (telefone, CEP, rua, número, complemento, bairro, cidade, UF ou referência)`,
        next: "fechamento",
      };
    }

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
  }

  // pronto para gerar pedido (modo concierge: sem link)
  return {
    reply:
      `Perfeito! Já deixei **seu pedido no COD preparado** ✅\n` +
      `Você vai receber as atualizações por aqui. Qualquer dúvida, tô pertinho de você 💖`,
    next: "posvenda",
  };
}
