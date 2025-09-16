// configs/bots/claudia/flow/close.js
import { callUser, summarizeAddress } from "./_state.js";

const ASK_ORDER = [
  { key: "telefone",     q: "Pra agilizar seu **pedido COD**, me passa seu *telefone* com DDD?" },
  { key: "cep",          q: "Qual o seu **CEP**?" },
  { key: "rua",          q: "Rua ou avenida?" },
  { key: "numero",       q: "Número?" },
  { key: "complemento",  q: "Complemento (se houver)?" },
  { key: "bairro",       q: "Bairro?" },
  { key: "cidade",       q: "Cidade?" },
  { key: "uf",           q: "Estado (UF)?" },
  { key: "referencia",   q: "Um ponto de referência ajuda na entrega 😉" },
];

const RX = {
  telefone: /(\+?55)?\s*\(?(?<ddd>\d{2})\)?\s*(?<p1>\d{4,5})[-.\s]?(?<p2>\d{4})/i,
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
  if (!state.cidade)    { const c = text.match(/\b([A-Za-zÀ-ú' ]{3,})\b/); if (c) state.cidade = c[0].trim(); }
  if (!state.complemento){ const c = text.match(/\b(apto|ap|bloco|casa|fundos|sobrado)\b[^,\n]*/i); if (c) state.complemento = c[0].trim(); }
  if (!state.referencia){ const r = text.match(/\b(refer[eê]ncia|perto de|ao lado de)\b[^.\n]*/i); if (r) state.referencia = r[0].replace(/^refer[eê]ncia[: ]*/i, "").trim(); }
}

const nextMissing = (s) => ASK_ORDER.find(i => !s[i.key]);

export default async function close(ctx) {
  const { text = "", state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;

  // Failsafe: se pedir link aqui, envia de novo
  if (state.__send_link_on_close_once !== true && (state.link_allowed || /link|checkout/i.test(text))) {
    state.__send_link_on_close_once = true;
    const link = settings?.product?.checkout_link || "";
    return { reply: `Segue o **link seguro do checkout**: ${link}\nQualquer dúvida, tô aqui 💛`, next: "fechamento" };
  }

  smartFill(state, text);

  const missing = nextMissing(state);
  if (missing) {
    const now = Date.now();
    const tag = `__asked_${missing.key}_at`;
    if (!state[tag] || (now - state[tag]) > 60_000) {
      state[tag] = now;
      return { reply: missing.q, next: "fechamento" };
    }
    return { reply: `Me passa isso rapidinho pra eu confirmar teu pedido 😉`, next: "fechamento" };
  }

  const resumo = summarizeAddress(state);
  return {
    reply: `Perfeito, ${callUser(state)}! Confere:\n${resumo}\n\nConfirmo teu pedido COD agora?`,
    next: "posvenda",
  };
}
