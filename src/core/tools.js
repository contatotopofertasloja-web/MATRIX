// src/core/tools.js
// Fontes de verdade para o orquestrador (NÃO inventam)

import { settings } from "../../configs/src/core/settings.js";

const getS = (s) => s || settings;

const numEnv = (k, fallback) => {
  const raw = process.env[k];
  if (raw == null) return fallback;
  const n = Number(String(raw).replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
};

export async function getPrice({ settings: s }) {
  const SS = getS(s);
  const p = SS?.product || {};
  const orig = numEnv("PRICE_ORIGINAL", typeof p.price_original === "number" ? p.price_original : 197);
  const targ = numEnv("PRICE_TARGET",   typeof p.price_target   === "number" ? p.price_target   : orig);
  return { original: orig, price: targ };
}

export async function getCheckoutLink({ settings: s }) {
  const SS = getS(s);
  const env = (process.env.CHECKOUT_LINK || "").trim();
  return { url: env || SS?.product?.checkout_link || "" };
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
  const key = String(args?.key || "").trim();
  if (key && cats[key]?.answers?.length) return { answer: cats[key].answers[0] };

  const text = String(args?.text || "").toLowerCase();
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
