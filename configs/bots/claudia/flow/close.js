// configs/bots/claudia/flow/close.js
import { summarizeAddress, tagReply } from "./_state.js";

const ASK = [
  { key: "telefone", q: "Pra agilizar seu **pedido COD**, me passa seu *telefone* com DDD?" },
  { key: "cep",      q: "Qual o seu **CEP**?" },
  { key: "rua",      q: "Rua ou avenida?" },
  { key: "numero",   q: "Número?" },
  { key: "complemento", q: "Complemento (se houver)?" },
  { key: "bairro",   q: "Bairro?" },
  { key: "cidade",   q: "Cidade?" },
  { key: "uf",       q: "Estado (UF)?" },
];

const RX = {
  TEL: /(\+?55)?\s*\(?(?<ddd>\d{2})\)?\s*(?<p1>\d{4,5})[-.\s]?(?<p2>\d{4})/i,
  CEP: /\b(?<cep>\d{5})[-.\s]?(?<suf>\d{3})\b/,
  UF:  /\b(?<uf>[A-Z]{2})\b/,
  LINK: /\b(link|checkout)\b/i,
};

function fill(s, t = "") {
  if (!s.telefone) { const m = t.match(RX.TEL); if (m?.groups) s.telefone = `(${m.groups.ddd}) ${m.groups.p1}-${m.groups.p2}`; }
  if (!s.cep)      { const m = t.match(RX.CEP); if (m?.groups) s.cep = `${m.groups.cep}-${m.groups.suf}`; }
  if (!s.uf)       { const m = t.toUpperCase().match(RX.UF); if (m?.groups) s.uf = m.groups.uf; }
}

const nextMissing = (s) => ASK.find(i => !s[i.key]);

export default async function close(ctx) {
  const { text = "", state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;
  state.stage = "fechamento"; // sticky: não “volta” pro qualify sem pedido explícito

  // Link no fechamento
  if (RX.LINK.test(text) || state.link_allowed) {
    state.link_allowed = false;
    const link = settings?.product?.checkout_link || "";
    return { reply: tagReply(settings, `Prontinho! **Checkout seguro**: ${link}`, "flow/close"), next: "fechamento" };
  }

  fill(state, String(text || ""));

  const missing = nextMissing(state);
  if (missing) return { reply: tagReply(settings, missing.q, "flow/close"), next: "fechamento" };

  const resumo = summarizeAddress(state);
  state.consent_checkout = true;
  return { reply: tagReply(settings, `Confere seus dados:\n${resumo}\nSe estiver ok, diga **confirmo** que eu finalizo pra você.`, "flow/close"), next: "fechamento" };
}
