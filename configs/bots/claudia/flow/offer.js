// configs/bots/claudia/flow/offer.js
// Oferta personalizada + objeções comuns + preço/link/entrega.

import { callUser, tagReply, normalizeSettings } from "./_state.js";

const RX = {
  PRICE: /(preç|valor|quanto|cust)/i,
  LINK:  /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho|pagamento)\b/i,
  OBJECTION_PRICE:  /\b(car[oa]|car[oa]|t[áa]\s*car[oa])\b/i,
  OBJECTION_SAFETY: /\b(golpe|seguran[çc]a|anvisa|registro)\b/i,
  OBJECTION_EFFECT: /\b(funciona|resultado|n[aã]o\s*pega|n[aã]o\s*alisa)\b/i,
};

function pitch(state, S) {
  const parts = [];
  const p = state?.profile || {};
  if (p.hair_type) parts.push(`para cabelo **${p.hair_type}**`);
  if (p.goal) parts.push(`focando em **${p.goal}**`);
  if (p.had_prog_before != null) {
    parts.push(p.had_prog_before ? "ótimo pra quem **já fez**" : "seguro pra **primeira aplicação**");
  }
  return parts.length ? parts.join(" · ") : "com efeito de alinhamento e brilho";
}

function deliveryLine(S) {
  const c = S.product.delivery_sla.capitals_hours;
  const o = S.product.delivery_sla.others_hours;
  return `Prazo: **${c}h** capitais / **${o}h** demais regiões.`;
}

export default async function offer(ctx) {
  const { state, text, settings } = ctx;
  const S = normalizeSettings(settings);
  state.turns = (state.turns || 0) + 1;

  // objeções
  if (RX.OBJECTION_PRICE.test(text || "")) {
    const ans = `Entendo 👍 Comparando com salão, **sai bem mais em conta** e você usa em casa.
De **R$${S.product.price_original}** por **R$${S.product.price_target}**.
${deliveryLine(S)} Posso **garantir** essa condição e te mandar o link?`;
    return tagReply(S, ans, "flow/offer#objection_price");
  }
  if (RX.OBJECTION_SAFETY.test(text || "")) {
    const ans = `Fica tranquila 💚 É **pago na entrega (COD)** — você só paga quando chega.
São mais de **${S.marketing.sold_count}** clientes satisfeitas. Quer o site oficial também?`;
    return tagReply(S, ans, "flow/offer#objection_safety");
  }
  if (RX.OBJECTION_EFFECT.test(text || "")) {
    const ans = `A progressiva **alinha, reduz frizz** e pode **alisar** conforme a finalização.
Passo a passo: aplicar, agir **40 min**, enxaguar e finalizar (escova/chapinha). Te envio o **guia rápido**?`;
    return tagReply(S, ans, "flow/offer#objection_effect");
  }

  // preço ou link direto
  if (RX.PRICE.test(text || "")) {
    const ans = `Condição hoje: de **R$${S.product.price_original}** por **R$${S.product.price_target}**.
${deliveryLine(S)} Quer o **link seguro** pra finalizar?`;
    return tagReply(S, ans, "flow/offer#price");
  }
  if (RX.LINK.test(text || "")) {
    const link = S.product.checkout_link;
    const ans = `Aqui o **checkout seguro**: ${link}
${deliveryLine(S)} Forma: **COD (paga na entrega)**.`;
    // Se o orquestrador/outbox suportar flags, ele pode ler meta.allowLink.
    return { reply: tagReply(S, ans, "flow/offer#link"), next: undefined, meta: { allowLink: true } };
  }

  // oferta personalizada
  const name = callUser(state);
  const msg = `${name ? name + ", " : ""}pelo que você me contou, recomendo a **${S.product.name}** ${pitch(state, S)}.
De **R$${S.product.price_original}** por **R$${S.product.price_target}**. Te envio o **link seguro** pra finalizar?`;
  return tagReply(S, msg, "flow/offer#pitch");
}
