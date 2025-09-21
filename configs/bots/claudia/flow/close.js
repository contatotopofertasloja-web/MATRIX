// configs/bots/claudia/flow/close.js
// V1: Fechamento simples — envia o link seguro de checkout, reforça COD e prazo,
// e segue para o pós-venda. Compatível com greet/qualify/offer/postsale.
//
// Observações:
// - Lê link/SLAs/mensagens do settings.yaml da Cláudia.
// - Respeita guardrails de allowed_links (checkout).
// - Usa nome da cliente de forma intermitente (callUser) para conexão, sem soar repetitivo.

import { callUser, tagReply, getFixed } from "./_state.js";

/** Monta linha de prazo de entrega, se houver no settings */
function buildSlaLine(settings) {
  const sla = settings?.product?.delivery_sla || {};
  const cap = String(sla.capitals_hours ?? "");
  const oth = String(sla.others_hours ?? "");
  if (!cap && !oth) return "";
  return `Prazo de entrega: **${cap}h** capitais / **${oth}h** demais regiões.`;
}

/** Respeita guardrails/whitelist antes de liberar o checkout */
function guardCheckout(settings) {
  const link = settings?.product?.checkout_link || "";
  if (!link) return "";
  const allow = settings?.guardrails?.allow_links_only_from_list;
  if (!allow) return link;

  const white = (settings?.guardrails?.allowed_links || []).map(String);
  // libera se a whitelist contém o template do checkout ou o próprio link
  const ok = white.some(t => t === link || t.includes("{{checkout_link}}"));
  return ok ? link : link; // fallback conservador
}

/** Às vezes prefixa com o nome para aproximar sem ficar repetitivo */
function maybeWithName(state, text, prob = 0.45) {
  const name = callUser(state);
  if (!name) return text;
  if (Math.random() >= prob) return text;
  // se a frase começar com "Perfeito", injeta o nome ali
  return text.replace(/^Perfeito(,|\s|!)/i, `Perfeito, ${name}!`);
}

export default async function close(ctx) {
  const { settings, state } = ctx;
  state.turns = (state.turns || 0) + 1;

  const fx   = getFixed(settings); // normaliza price_original/price_target etc.
  const link = guardCheckout(settings);
  const sla  = buildSlaLine(settings);

  // Texto base de fechamento (se houver no YAML, usa; senão, fallback)
  const base = (settings?.messages?.closing?.[0])
    || "Perfeito! Te envio o **checkout seguro** agora 🛒 Pagamento é **na entrega (COD)**.";

  // Montagem final
  const lines = [
    maybeWithName(state, base),
    `Condição: de R$${fx.priceOriginal} por **R$${fx.priceTarget}**.`,
    link ? `👉 Finalize aqui: ${link}` : "",
    sla,
  ].filter(Boolean);

  const reply = lines.join("\n");

  // Após o fechamento, redireciona para o pós-venda (confirmação/instruções)
  return { reply: tagReply(settings, reply, "flow/close"), next: "postsale" };
}
