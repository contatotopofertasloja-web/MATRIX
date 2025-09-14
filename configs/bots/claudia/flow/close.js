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

const RX = {
  telefone: /(?:\b(?:tel|telefone|cel|whats?)\b[: ]*)?(\+?55)?\s*\(?(?<ddd>\d{2})\)?\s*(?<p1>\d{4,5})[-.\s]?(?<p2>\d{4})/i,
  cep: /\b(?<cep>\d{5})[-.\s]?(?<suf>\d{3})\b/,
  numero: /\b(?<num>\d{1,6})(?:\s*(?:n[oº]|numero|número))?\b/i,
  uf: /\b(?<uf>[A-Z]{2})\b/,
};

function smartFill(state, textRaw) {
  const text = String(textRaw || "").trim();
  if (!text) return;
  if (!state.telefone) { const m = text.match(RX.telefone); if (m) state.telefone = `(${m.groups.ddd}) ${m.groups.p1}-${m.groups.p2}`; }
  if (!state.cep)      { const m = text.match(RX.cep);      if (m) state.cep = `${m.groups.cep}-${m.groups.suf}`; }
  if (!state.numero)   { const m = text.match(RX.numero);   if (m) state.numero = m.groups.num; }
  if (!state.uf)       { const m = text.toUpperCase().match(RX.uf); if (m) state.uf = m.groups.uf; }

  if (!state.rua)       { const r = text.match(/(?:rua|av\.?|avenida|travessa|alameda)\s+([^,|\n]+)/i); if (r) state.rua = r[0].trim(); }
  if (!state.bairro)    { const b = text.match(/\b(bairro|jd\.?|jardim|centro|vila)\b[^,\n]*/i); if (b) state.bairro = b[0].replace(/^(bairro\s*)/i, "").trim(); }
  if (!state.cidade)    { const c = text.match(/\b(cidade|munic[ií]pio)\b[: ]*([A-Za-zÀ-ú' ]{3,})/i); if (c) state.cidade = c[2].trim(); }
  if (!state.complemento){ const c = text.match(/\b(apto|ap|bloco|bl|fundos|casa\s*\d+|casa|sobrado|edif[ií]cio)\b[^,\n]*/i); if (c) state.complemento = c[0].trim(); }
  if (!state.referencia){ const r = text.match(/\b(refer[eê]ncia|perto de|ao lado de)\b[^.\n]*/i); if (r) state.referencia = r[0].replace(/^refer[eê]ncia[: ]*/i, "").trim(); }
}

function nextMissing(state) { return ASK_ORDER.find(i => !state[i.key]); }
function isYes(text = "") { return /\b(sim|pode|ok|okay|confirmo|confirmada|t[aã]\s*bom|t[aã]\s*ótimo|isso|fechar|manda)\b|👍|✔|✅/i.test(text); }
function isNo(text = "")  { return /\b(n[aã]o|negativo|pera|espera|calma|corrigir|editar|mudar|alterar)\b|👎/i.test(text); }

export default async function close(ctx) {
  const { state, text = "" } = ctx;
  state.turns = (state.turns || 0) + 1;

  smartFill(state, text);

  let miss = nextMissing(state);
  if (miss) return { reply: `${miss.q}`, next: "fechamento" };

  if (!state.consent_checkout) {
    if (text && isYes(text)) {
      state.consent_checkout = true;
    } else if (text && isNo(text)) {
      return { reply: `Claro, ${callUser(state)}! Qual **dado** você quer corrigir? (telefone, CEP, rua, número, complemento, bairro, cidade, UF ou referência)`, next: "fechamento" };
    } else {
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

  return {
    reply:
      `Perfeito! Já deixei **seu pedido no COD preparado** ✅\n` +
      `Você vai receber as atualizações por aqui. Qualquer dúvida, tô pertinho de você 💖`,
    next: "posvenda",
  };
}
