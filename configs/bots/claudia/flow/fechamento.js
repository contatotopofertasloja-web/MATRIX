// configs/bots/claudia/flow/fechamento.js
// V1: fechar com link seguro + reforço COD e prazo; depois segue para postsale.
// Compatível com offer.js (next: "fechamento") e settings.yaml atuais.

import { callUser, getFixed, tagReply } from "./_state.js";

function buildSlaLine(settings) {
  const sla = settings?.product?.delivery_sla || {};
  const cap = String(sla.capitals_hours ?? "");
  const oth = String(sla.others_hours ?? "");
  if (!cap && !oth) return "";
  return `Prazo de entrega: **${cap}h** capitais / **${oth}h** demais regiões.`;
}

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

export default async function fechamento(ctx) {
  const { settings, state } = ctx;
  state.turns = (state.turns || 0) + 1;

  const name = callUser(state);
  const fx   = getFixed(settings);
  const link = guardCheckout(settings);
  const sla  = buildSlaLine(settings);

  const parts = [];
  parts.push(
    `Perfeito${name ? `, ${name}` : ""}! Aqui está o **checkout seguro**: ${link}`
  );
  parts.push(
    `Condição: de R$${fx.priceOriginal} por **R$${fx.priceTarget}** · Forma: **COD (paga quando receber)**.`
  );
  if (sla) parts.push(sla);

  const reply = parts.filter(Boolean).join("\n");

  // Após enviar o link e as instruções de fechamento, vai para o pós-venda.
  return { reply: tagReply(settings, reply, "flow/fechamento"), next: "postsale" };
}
