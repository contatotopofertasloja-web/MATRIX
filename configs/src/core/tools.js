// src/core/tools.js
// Fontes de verdade para o orquestrador (NÃO inventam)

import { settings } from "./settings.js";

const getS = (s) => s || settings;

export async function getPrice({ settings: s }) {
  const SS = getS(s);
  const p = SS?.product || {};
  const price = typeof p.price_target === "number" ? p.price_target : p.price_original;
  return { price };
}

export async function getCheckoutLink({ settings: s }) {
  const SS = getS(s);
  return { url: SS?.product?.checkout_link || "" };
}

export async function getDeliverySLA({ settings: s }) {
  const SS = getS(s);
  const sla = SS?.product?.delivery_sla || {};
  return { capitals_hours: sla.capitals_hours || 24, others_hours: sla.others_hours || 72 };
}

export async function getPaymentInfo({ settings: s }) {
  const SS = getS(s);
  const cod = SS?.messages?.cod_short || "Pagamento na entrega (COD).";
  return { payment: "COD", text: cod };
}

// Consulta FAQ embutido no settings (`settings.faq.categories`)
export async function getFAQ({ args = {}, settings: s }) {
  const SS = getS(s);
  const cats = SS?.faq?.categories || {};
  const key = String(args?.key || "").trim(); // se vier uma chave explícita
  if (key && cats[key]?.answers?.length) return { answer: cats[key].answers[0] };

  const text = String(args?.text || "").toLowerCase();
  // tenta casar por triggers
  for (const k of Object.keys(cats)) {
    const trigs = cats[k]?.triggers || [];
    for (const patt of trigs) {
      const rx = new RegExp(patt, "i");
      if (rx.test(text)) {
        const answers = cats[k]?.answers || [];
        if (answers.length) return { answer: answers[Math.floor(Math.random() * answers.length)] };
      }
    }
  }
  return { answer: "" };
}
