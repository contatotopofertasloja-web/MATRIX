// configs/bots/claudia/flow/faq.js
// FAQ com respostas objetivas sobre: entrega, pagamento, nome do produto, empresa,
// horários, promo/garantia, uso/rendimento/duração, tamanho (ml), parcelamento,
// áudio e cuidados/contraindicações básicos.

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
    /audio|áudio|mandar\s*voz/.test(t) ||
    /alerg|contraindica|gestant|lactant|dermatite|sensibilid/i.test(t)
  );
}

export default async function faq(ctx) {
  const { jid, text = "", settings, state = {} } = ctx;
  state.turns = (state.turns || 0) + 1;

  const S = normalizeSettings(settings);
  const t = norm(text);

  // memória (nome)
  try {
    const saved = await recall(jid);
    if (saved?.profile) state.profile = { ...(state.profile || {}), ...saved.profile };
  } catch {}

  const name = callUser(state);

  // Entrega / SP
  if (/entrega(s)?|frete|prazo|s[ãa]o paulo|sp\b/.test(t)) {
    const sla = S.product.delivery_sla || {};
    const msg = `Entregamos em São Paulo e região. Prazo médio: ${sla.capitals_hours}h capitais / ${sla.others_hours}h demais locais.`;
    return { reply: tagReply(S, msg, "flow/faq#entrega"), next: "oferta" };
  }

  // Pagamentos
  if (/pix|cart[aã]o|boleto|pagamento|na entrega/.test(t)) {
    const msg = `Temos pagamento na entrega (COD). No site também dá para pagar via PIX e cartão. Quer que eu te envie o link seguro?`;
    return { reply: tagReply(S, msg, "flow/faq#pagamento"), next: "fechamento" };
  }

  // Produto / empresa / horários
  if (/nome do produto|qual\s*é\s*o\s*produto|como\s*se\s*chama\s*o\s*produto/.test(t)) {
    return { reply: tagReply(S, `O nome é ${S.product.name}. Quer que eu resuma como funciona?`, "flow/faq#produto"), next: "oferta" };
  }
  if (/empresa|voc[eê]s s[aã]o quem|nome da empresa/.test(t)) {
    const empresa = S.product.store_name || "TopOfertas";
    return { reply: tagReply(S, `Somos a ${empresa} 🧡. Posso te ajudar a decidir se combina com teu cabelo, ${name || "amiga"}?`, "flow/faq#empresa"), next: "oferta" };
  }
  if (/hor[aá]rio|atendem|funciona at[eé] quando|que horas voc[eê]s abrem|fecha/.test(t)) {
    const hours = S.product.opening_hours || "06:00–21:00";
    return { reply: tagReply(S, `Atendemos ${hours} (BRT). Quer aproveitar e tirar uma dúvida agora?`, "flow/faq#horario"), next: "oferta" };
  }

  // Promo / garantia
  if (/sorteio|brinde|premi/.test(t)) {
    const on = settings?.promotions?.raffle?.enabled === true;
    const teaser = on
      ? (settings?.promotions?.raffle?.teaser || "Comprando este mês você participa do nosso sorteio de prêmios. Quer que eu explique rapidinho?")
      : "No momento não temos sorteios ativos, mas te aviso se abrir um novo! ✨";
    return { reply: tagReply(S, teaser, "flow/faq#sorteio"), next: "oferta" };
  }
  if (/garanti|troca|devolu/.test(t)) {
    const g = settings?.product?.refund_days_after_delivery ?? 7;
    return { reply: tagReply(S, `Você tem ${g} dias após receber. Se não amar, devolvemos sem burocracia. Quer ver o passo a passo de uso?`, "flow/faq#garantia"), next: "oferta" };
  }

  // Uso / rendimento / duração
  if (/aplica|rende|quantas vezes|dura|mes(es)?/.test(t)) {
    const applications = settings?.messages?.applications_hint || "2–4 aplicações (varia com comprimento)";
    const duration = settings?.messages?.duration_hint || "de 2 a 3 meses";
    return { reply: tagReply(S, `Rende ${applications} e costuma durar ${duration}. Quer que eu mande o resumo de aplicação?`, "flow/faq#uso"), next: "oferta" };
  }

  // Tamanho (ml)
  if (/\bml\b|mili|frasco|tamanho/.test(t)) {
    const ml = settings?.product?.volume_ml || 500;
    return { reply: tagReply(S, `O frasco tem ${ml} ml.`, "flow/faq#tamanho"), next: "oferta" };
  }

  // Parcelamento
  if (/parcel|divid/.test(t)) {
    return { reply: tagReply(S, `Dá para parcelar no site e também temos pagamento na entrega (COD). Quer o link seguro?`, "flow/faq#parcelamento"), next: "fechamento" };
  }

  // Áudio
  if (/audio|áudio|mandar\s*voz/.test(t)) {
    return { reply: tagReply(S, `Se preferir, te mando um áudio com o resumo rapidinho. Quer, ${name || "amiga"}?`, "flow/faq#audio"), next: "oferta" };
  }

  // Cuidados / contraindicações básicas
  if (/alerg|contraindica|gestant|lactant|dermatite|sensibilid/i.test(t)) {
    const msg =
      `O produto é livre de formol e de uso cosmético. Se você tem histórico de alergia ou couro cabeludo sensível, ` +
      `recomendamos teste de mecha/pitadinha antes da aplicação completa, evitar contato com olhos/mucosas e seguir o modo de uso. ` +
      `Gestantes e lactantes devem consultar seu médico antes de usar qualquer cosmético. Quer o resumo de aplicação?`;
    return { reply: tagReply(S, msg, "flow/faq#cuidados"), next: "oferta" };
  }

  // Fallback
  return { reply: tagReply(S, `Posso te ajudar com entrega, pagamento, uso, rendimento, tamanho do frasco e garantia. O que você prefere saber primeiro, ${name || "querida"}?`, "flow/faq#fallback"), next: "oferta" };
}
