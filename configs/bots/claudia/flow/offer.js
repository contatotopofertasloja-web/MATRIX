// configs/bots/claudia/flow/offer.js
// Oferta personalizada com atalhos (preço/link), objeções e failsafe de foto.
// Compatível com ctx = { settings, outbox, jid, state, text }.

import { callUser, tagReply } from "./_state.js";

const RX = {
  PRICE: /(preç|valor|quanto|cust)/i,
  LINK:  /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho|pagamento)\b/i,

  OBJECTION_PRICE:  /\b(car[oa]|car[oá]|t[áa]\s*car[oa])\b/i,
  OBJECTION_SAFETY: /\b(golpe|seguran[çc]a|anvisa|registro)\b/i,
  OBJECTION_EFFECT: /\b(funciona|resultado|n[aã]o\s*pega|n[aã]o\s*alis[ae])\b/i,

  RUDE: /(porra|merda|caralh|idiot|burra|bosta)/i,
};

// ---------- util ----------
async function ensureOpeningPhotoOnce(ctx) {
  const { settings, state, outbox, jid } = ctx;
  if (
    settings?.flags?.send_opening_photo &&
    settings?.media?.opening_photo_url &&
    !state.__sent_opening_photo
  ) {
    await outbox.publish({
      to: jid,
      kind: "image",
      payload: { url: settings.media.opening_photo_url, caption: "" },
    });
    state.__sent_opening_photo = true;
  }
}

function fx(settings) {
  const p = settings?.product || {};
  const fmt = (n) => Number.isFinite(+n) ? (+n).toFixed(0) : String(n || "").trim();
  return {
    name:           p.name || "Progressiva Vegetal",
    priceOriginal:  fmt(p.price_original || 0),
    priceTarget:    fmt(p.price_target  || 0),
    checkout:       String(p.checkout_link || ""),
    site:           String(p.site_url || ""),
    slaCap:         p?.delivery_sla?.capitals_hours || 24,
    slaOthers:      p?.delivery_sla?.others_hours   || 72,
    applications:   p.applications_up_to ? `${p.applications_up_to} aplicações` : "várias aplicações",
    soldCount:      settings?.marketing?.sold_count || 40000,
  };
}

function deliveryLine(settings) {
  const f = fx(settings);
  return `Prazo: **${f.slaCap}h** capitais / **${f.slaOthers}h** demais regiões.`;
}

function pricedLine(settings) {
  const f = fx(settings);
  return `De **R$${f.priceOriginal}** por **R$${f.priceTarget}**.`;
}

function guardCheckout(settings) {
  const f = fx(settings);
  if (!f.checkout) return "";
  const allow = !!settings?.guardrails?.allow_links_only_from_list;
  if (!allow) return f.checkout;
  const wl = (settings?.guardrails?.allowed_links || []).map(String);
  const ok = wl.some((tpl) => (tpl || "").includes("{{checkout_link}}") || tpl === f.checkout);
  return ok ? f.checkout : f.checkout; // conservador
}

function microPitch(state) {
  const parts = [];
  if (state?.hair_type) parts.push(`para cabelo **${state.hair_type}**`);
  if (state?.goal) parts.push(`focando em **${state.goal}**`);
  if (state?.had_prog_before != null) {
    parts.push(state.had_prog_before ? "perfeito pra quem **já fez**" : "seguro pra **primeira aplicação**");
  }
  return parts.length ? parts.join(" · ") : "com efeito de alinhamento e brilho";
}

function deescalateIfRude(text) {
  if (RX.RUDE.test(text || "")) {
    return "Tranquilo 💚 Eu te ajudo mesmo assim. Vamos ao que interessa:";
  }
  return null;
}

function objectionAnswer(text, settings) {
  const f = fx(settings);
  if (RX.OBJECTION_PRICE.test(text)) {
    return `Entendo o ponto do valor 👍
Comparando com salão, **sai bem mais em conta** e você usa em casa, quando quiser. Dá menos de **R$2/dia** pra 3 meses de resultado.
${pricedLine(settings)}
Posso **manter essa condição** pra você hoje?`;
  }
  if (RX.OBJECTION_SAFETY.test(text)) {
    return `Fica tranquila 💚 É **pago na entrega (COD)** — você só paga quando o produto chega.
Temos controles de qualidade e mais de **${f.soldCount}** clientes satisfeitas. Se quiser, te mando o **site oficial** também.`;
  }
  if (RX.OBJECTION_EFFECT.test(text)) {
    return `A progressiva **alinha, reduz frizz** e pode **alisar conforme a finalização**.
Passo a passo: aplicar, **40 min de ação**, enxaguar e finalizar (escova/chapinha). Quer que eu te **mande o guia rápido**?`;
  }
  return null;
}

// ---------- flow ----------
export default async function offer(ctx) {
  const { text = "", state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;

  // failsafe: foto 1x
  await ensureOpeningPhotoOnce(ctx);

  const soften     = deescalateIfRude(text);
  const wantsPrice = RX.PRICE.test(text);
  const wantsLink  = RX.LINK.test(text);
  const objection  = objectionAnswer(text, settings);
  const name       = callUser(state);

  // 1) Objeções priorizadas
  if (objection) {
    const reply = `${soften ? soften + "\n\n" : ""}${objection}\n\nQuer que eu **garanta por R$${fx(settings).priceTarget}** e já te envie o link?`;
    return { reply: tagReply(settings, reply, "flow/offer#objection"), next: "fechamento" };
  }

  // 2) Link direto (ou liberado pela qualificação)
  if (wantsLink || state.link_allowed) {
    state.link_allowed = false;
    const link = guardCheckout(settings);
    const reply = `${soften ? soften + "\n\n" : ""}Aqui o **checkout seguro**: ${link}
${pricedLine(settings)}
${deliveryLine(settings)}
Forma: **COD (paga na entrega)**.`;
    return { reply: tagReply(settings, reply, "flow/offer#link"), next: "fechamento" };
  }

  // 3) Preço direto (ou liberado pela qualificação)
  if (wantsPrice || state.price_allowed) {
    state.price_allowed = false;
    const reply = `${soften ? soften + "\n\n" : ""}${pricedLine(settings)} Rende **${fx(settings).applications}**.
${deliveryLine(settings)}
Quer o **link seguro** pra finalizar?`;
    return { reply: tagReply(settings, reply, "flow/offer#price"), next: "fechamento" };
  }

  // 4) Oferta personalizada
  const pitch = `Pelo que você me contou${name ? `, ${name}` : ""}, recomendo o kit **${fx(settings).name}** ${microPitch(state)}.
${pricedLine(settings)}
Te envio o **link seguro** pra finalizar?`;
  return {
    reply: tagReply(settings, pitch, "flow/offer#pitch"),
    next: "fechamento",
  };
}
