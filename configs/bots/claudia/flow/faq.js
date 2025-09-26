// configs/bots/claudia/flow/faq.js
// Perguntas frequentes (FAQ) integradas à memória unificada

import { callUser, tagReply, normalizeSettings } from "./_state.js";
import { recall } from "../../../../src/core/memory.js";

function norm(s = "") { return String(s || "").toLowerCase(); }

export function match(text = "", _settings = {}) {
  const t = norm(text);
  return (
    /entrega(s)?|frete|prazo|s[ãa]o paulo|sp\b/.test(t) ||
    /pix|cart[aã]o|boleto|pagamento|na entrega/.test(t) ||
    /nome do produto|qual\s*é\s*o\s*produto|como\s*se\s*chama\s*o\s*produto/.test(t) ||
    /empresa|voc[eê]s\s*s[ãa]o\s*quem|nome\s*da\s*empresa/.test(t) ||
    /hor[aá]rio|atendem|funciona\s*at[eé]\s*quando|que\s*horas\s*voc[eê]s\s*abrem|fecha/.test(t) ||
    /sorteio|brinde|premi/.test(t) ||
    /garanti|troca|devolu/.test(t) ||
    /aplica|rende|quantas\s*vezes|dura|mes(es)?/.test(t) ||
    /\bml\b|mili|frasco|tamanho/.test(t) ||
    /parcel|divid/.test(t) ||
    /audio|áudio|mandar\s*voz/.test(t)
  );
}

export default async function faq(ctx) {
  const { jid, text = "", settings, state = {} } = ctx;
  state.turns = (state.turns || 0) + 1;

  const S = normalizeSettings(settings);
  const t = norm(text);

  // recupera nome da memória unificada
  try {
    const saved = await recall(jid);
    if (saved?.profile) {
      state.profile = { ...(state.profile || {}), ...saved.profile };
    }
  } catch (e) {
    console.warn("[faq.recall]", e?.message);
  }

  const name = callUser(state);

  // Entrega / SP
  if (/entrega(s)?|frete|prazo|s[ãa]o paulo|sp\b/.test(t)) {
    const sla = S.product.delivery_sla || {};
    const msg = `Entregamos em São Paulo e região. Prazo médio: **${sla.capitals_hours}h** capitais / **${sla.others_hours}h** demais locais.`;
    return { reply: tagReply(S, msg, "flow/faq"), next: "oferta" };
  }

  // Pagamentos
  if (/pix|cart[aã]o|boleto|pagamento|na entrega/.test(t)) {
    const msg = `Temos **COD** (paga quando recebe). No site, rola **PIX** e **cartão** também. Quer que eu te envie o **link**?`;
    return { reply: tagReply(S, msg, "flow/faq"), next: "fechamento" };
  }

  // Nome do produto / empresa / horários
  if (/nome do produto|qual\s*é\s*o\s*produto|como\s*se\s*chama\s*o\s*produto/.test(t)) {
    const nm = S.product.name;
    return { reply: tagReply(S, `O nome do produto é **${nm}**. Quer que eu te explique rapidinho como ele funciona?`, "flow/faq"), next: "oferta" };
  }
  if (/empresa|voc[eê]s s[aã]o quem|nome da empresa/.test(t)) {
    const empresa = S.product.store_name || "TopOfertas";
    return { reply: tagReply(S, `Somos a **${empresa}** 🧡. Posso te ajudar a decidir se combina com teu cabelo, ${name || "amiga"}?`, "flow/faq"), next: "oferta" };
  }
  if (/hor[aá]rio|atendem|funciona at[eé] quando|que horas voc[eê]s abrem|fecha/.test(t)) {
    const hours = S.product.opening_hours || "06:00–21:00";
    return { reply: tagReply(S, `Atendemos **${hours} (BRT)**, ${name || "querida"}. Quer aproveitar e tirar uma dúvida agora?`, "flow/faq"), next: "oferta" };
  }

  // Promo / garantia / uso & rendimento / volume
  if (/sorteio|brinde|premi/.test(t)) {
    const on = settings?.promotions?.raffle?.enabled === true;
    const teaser = on
      ? (settings?.promotions?.raffle?.teaser || "Comprando este mês você participa do nosso sorteio de prêmios. Quer que eu te explique rapidinho?")
      : "No momento não temos sorteios ativos, mas te aviso se abrir um novo! ✨";
    return { reply: tagReply(S, teaser, "flow/faq"), next: "oferta" };
  }
  if (/garanti|troca|devolu/.test(t)) {
    const g = settings?.product?.refund_days_after_delivery ?? 7;
    return { reply: tagReply(S, `Você tem **${g} dias** após receber. Se não amar, devolvemos sem burocracia. Quer ver o passo a passo de uso?`, "flow/faq"), next: "oferta" };
  }
  if (/aplica|rende|quantas vezes|dura|mes(es)?/.test(t)) {
    const applications = settings?.messages?.applications_hint || "2–4 aplicações (varia com comprimento)";
    const duration = settings?.messages?.duration_hint || "de 2 a 3 meses";
    return { reply: tagReply(S, `Rende ${applications} e costuma durar ${duration}. Quer que eu te mande o resumo de aplicação?`, "flow/faq"), next: "oferta" };
  }
  if (/\bml\b|mili|frasco|tamanho/.test(t)) {
    const ml = settings?.product?.volume_ml || 500;
    return { reply: tagReply(S, `O frasco tem **${ml} ml**.`, "flow/faq"), next: "oferta" };
  }

  // Parcelamento
  if (/parcel|divid/.test(t)) {
    return { reply: tagReply(S, `Dá pra fazer **parcelado** no site, e também temos **COD** (paga só quando recebe). Quer o **link seguro**?`, "flow/faq"), next: "fechamento" };
  }

  // Áudio
  if (/audio|áudio|mandar\s*voz/.test(t)) {
    return { reply: tagReply(S, `Se preferir, te mando um **áudio** com o resumo rapidinho. Quer, ${name || "amiga"}?`, "flow/faq"), next: "oferta" };
  }

  // fallback
  return { reply: tagReply(S, `Posso te ajudar com as principais dúvidas (uso, prazo, garantia, parcelamento). O que você prefere saber primeiro, ${name || "querida"}?`, "flow/faq"), next: "oferta" };
}
