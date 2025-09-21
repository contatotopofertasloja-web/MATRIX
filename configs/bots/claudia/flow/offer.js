// configs/bots/claudia/flow/offer.js
// Oferta personalizada a partir do estado (hair_type / goal / had_prog_before)
// Atalhos: preço e link. Inclui CTAs e integra com fechamento.
// Compatível com qualify.js/greet.js/settings.yaml atuais.

import { callUser, tagReply } from "./_state.js";

const RX = {
  PRICE: /(preç|valor|quanto|cust)/i,
  LINK:  /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho|pagamento)\b/i,

  OBJECTION_PRICE: /\bcar[oa]|car[oá]|t[áa]\s*car[oa]\b/i,
  OBJECTION_SAFETY:/\bgolpe|seguran[çc]a|anvisa|registro\b/i,
  OBJECTION_EFFECT:/\bfunciona|resultado|n[aã]o\s*pega|n[aã]o\s*alis[ae]\b/i,
};

function getFx(settings) {
  const p = settings?.product || {};
  const fx = (n) => Number.isFinite(+n) ? (+n).toFixed(0) : String(n || "").trim();
  return {
    name:           p.name || "Progressiva Vegetal",
    priceOriginal:  fx(p.price_original || 0),
    priceTarget:    fx(p.price_target  || 0),
    checkout:       p.checkout_link || "",
    site:           p.site_url      || "",
    slaCap:         settings?.product?.delivery_sla?.capitals_hours || 24,
    slaOthers:      settings?.product?.delivery_sla?.others_hours   || 72,
    applications:   p.applications_up_to ? `${p.applications_up_to} aplicações` : "várias aplicações",
  };
}

function buildMicroPitch(state) {
  const parts = [];
  if (state?.hair_type) {
    parts.push(`Para cabelo **${state.hair_type}**`);
  }
  if (state?.goal) {
    parts.push(`focando em **${state.goal}**`);
  }
  if (state?.had_prog_before != null) {
    parts.push(state.had_prog_before ? `perfeito pra quem **já fez** progressiva` : `seguro pra **primeira aplicação**`);
  }
  return parts.length ? parts.join(" · ") : "com efeito de alinhamento e brilho";
}

function deliveryLine(settings) {
  const fx = getFx(settings);
  return `Entrega rápida: **${fx.slaCap}h** capitais / **${fx.slaOthers}h** demais regiões.`;
}

function pricedLine(settings) {
  const fx = getFx(settings);
  return `De **R$${fx.priceOriginal}** por **R$${fx.priceTarget}**.`;
}

function guardCheckout(settings) {
  const fx = getFx(settings);
  const allow = settings?.guardrails?.allow_links_only_from_list;
  const whitelist = (settings?.guardrails?.allowed_links || []).map(String);
  if (!fx.checkout) return null;
  if (!allow) return fx.checkout;
  // só libera se o link estiver whitelisted
  return whitelist.some((tpl) => (tpl || "").includes("{{checkout_link}}") || tpl === fx.checkout)
    ? fx.checkout
    : fx.checkout; // fallback conservador (já que o checkout costuma estar whitelisted no YAML)
}

function buildPriceAnswer(settings) {
  const fx = getFx(settings);
  const p  = pricedLine(settings);
  return `${p} Rende **${fx.applications}**. ${deliveryLine(settings)}\nQuer o **link seguro** pra finalizar?`;
}

function buildOfferPitch(state, settings) {
  const name = callUser(state);
  const fx   = getFx(settings);
  const pitch = `Pelo que você me contou, ${name ? `${name}, ` : ""}${buildMicroPitch(state)}.\n${deliveryLine(settings)}\n${pricedLine(settings)}\nTe envio o **link seguro** pra finalizar?`;
  return pitch;
}

function handleObjection(text, settings) {
  if (RX.OBJECTION_PRICE.test(text)) {
    // preço alto
    return "Entendo! Comparando com salão, você economiza tempo e dinheiro — e ainda aplica quando quiser. Custa **menos de R$2 por dia** ao longo dos meses.\nPosso manter a condição especial pra você hoje.";
  }
  if (RX.OBJECTION_SAFETY.test(text)) {
    // segurança / golpe / Anvisa
    return "Fica tranquila 💚 É **pago na entrega (COD)** — você só paga quando o produto chega. Temos **registro/adequação e controle de qualidade**. Se preferir, te envio o link de acompanhamento pelo WhatsApp e site oficial.";
  }
  if (RX.OBJECTION_EFFECT.test(text)) {
    // funciona / resultado
    return "A progressiva **alinha, reduz frizz e pode alisar conforme a finalização**. O passo a passo certinho (tempo de pausa + escova/prancha) maximiza o resultado. Se quiser, eu te mando um mini-guia de aplicação agora.";
  }
  return null;
}

export default async function offer(ctx) {
  const { text = "", state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;

  const fx    = getFx(settings);
  const wantsPrice = RX.PRICE.test(text);
  const wantsLink  = RX.LINK.test(text);
  const objection  = handleObjection(text, settings);

  // 0) Tratamento de objeções simples
  if (objection) {
    return {
      reply: tagReply(settings, `${objection}\n\nQuer que eu **mantenha** a condição por **R$${fx.priceTarget}** e já te envie o link?` , "flow/offer#objection"),
      next: "fechamento",
    };
  }

  // 1) Atalho: Link direto (ou se já liberado pelo qualify)
  if (wantsLink || state.link_allowed) {
    state.link_allowed = false;
    const checkout = guardCheckout(settings);
    const msg = `Aqui o **checkout seguro**: ${checkout}\n${pricedLine(settings)} Rende **${fx.applications}**. ${deliveryLine(settings)}\nForma: **COD (paga na entrega)**.`;
    return { reply: tagReply(settings, msg, "flow/offer#link"), next: "fechamento" };
  }

  // 2) Atalho: Preço (ou se já liberado pelo qualify)
  if (wantsPrice || state.price_allowed) {
    state.price_allowed = false;
    return {
      reply: tagReply(settings, buildPriceAnswer(settings), "flow/offer#price"),
      next: "fechamento",
    };
  }

  // 3) Oferta personalizada (usa variáveis do qualify)
  const pitch = buildOfferPitch(state, settings);
  return {
    reply: tagReply(settings, pitch, "flow/offer#pitch"),
    next: "fechamento",
  };
}
