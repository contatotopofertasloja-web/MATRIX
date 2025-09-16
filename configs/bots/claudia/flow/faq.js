// configs/bots/claudia/flow/faq.js
import { callUser, getFixed, tagReply } from "./_state.js";

function norm(s = "") { return String(s || "").toLowerCase(); }

export function match(text = "", settings = {}) {
  const t = norm(text);
  return (
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
  const { text = "", settings, state } = ctx;
  state.turns = (state.turns || 0) + 1;
  const fx = getFixed(settings);
  const t = norm(text);

  if (/nome do produto|qual\s*é\s*o\s*produto|como\s*se\s*chama\s*o\s*produto/.test(t)) {
    const nm = settings?.product?.name || "Progressiva Vegetal";
    return { reply: tagReply(settings, `O nome do produto é **${nm}**. Quer que eu te explique rapidinho como ele funciona?`, "flow/faq"), next: "oferta" };
  }
  if (/empresa|voc[eê]s s[aã]o quem|nome da empresa/.test(t)) {
    const empresa = settings?.company?.name || fx?.empresa || "TopOfertas";
    return { reply: tagReply(settings, `Somos a **${empresa}** 🧡. Posso te ajudar a decidir se combina com teu cabelo?`, "flow/faq"), next: "oferta" };
  }
  if (/hor[aá]rio|atendem|funciona at[eé] quando|que horas voc[eê]s abrem|fecha/.test(t)) {
    const hours = settings?.company?.hours || fx?.hora || "06:00–21:00";
    return { reply: tagReply(settings, `Atendemos **${hours} (BRT)**, ${callUser(state)}. Quer aproveitar e tirar uma dúvida agora?`, "flow/faq"), next: "oferta" };
  }
  if (/sorteio|brinde|premi/.test(t)) {
    const on = fx?.sorteioOn === true || settings?.promotions?.raffle?.enabled === true;
    const teaser = on
      ? (settings?.promotions?.raffle?.teaser || "Comprando este mês você participa do nosso sorteio de prêmios. Quer que eu te explique rapidinho?")
      : "No momento não temos sorteios ativos, mas te aviso se abrir um novo! ✨";
    return { reply: tagReply(settings, teaser, "flow/faq"), next: "oferta" };
  }
  if (/garanti|troca|devolu/.test(t)) {
    const g = settings?.product?.refund_days_after_delivery ?? 7;
    return { reply: tagReply(settings, `Você tem **${g} dias** após receber. Se não amar, devolvemos sem burocracia. Quer ver o passo a passo de uso?`, "flow/faq"), next: "oferta" };
  }
  if (/aplica|rende|quantas vezes|dura|mes(es)?/.test(t)) {
    const applications = fx?.applications || "várias aplicações";
    const duration = fx?.duration || "de 2 a 3 meses";
    return { reply: tagReply(settings, `Rende **${applications}** e costuma durar **${duration}** (depende dos cuidados). Quer que eu te mande o resumo de aplicação?`, "flow/faq"), next: "oferta" };
  }
  if (/\bml\b|mili|frasco|tamanho/.test(t)) {
    const ml = settings?.product?.volume_ml ?? 500;
    return { reply: tagReply(settings, `O frasco tem **${ml} ml**. Prefere que eu te explique o modo de uso ou já quer avançar pra garantir o seu?`, "flow/faq"), next: "oferta" };
  }
  if (/parcel|divid/.test(t)) {
    const installments = settings?.payments?.installments;
    const enabled = installments?.enabled !== false;
    const max = installments?.max_installments ?? 12;
    const txt = enabled ? `Rola parcelar em **até ${max}x**.` : `Trabalhamos forte com **Pagamento na Entrega (COD)** — super prático 😉`;
    return { reply: tagReply(settings, `${txt} Quer seguir?`, "flow/faq"), next: "oferta" };
  }
  if (/audio|áudio|mandar voz/.test(t)) {
    return { reply: tagReply(settings, `Pode mandar áudio sim, ${callUser(state)}! Eu te acompanho 💬`, "flow/faq"), next: "oferta" };
  }

  return { reply: tagReply(settings, `Me diz o que mais te incomoda hoje: frizz, volume ou falta de brilho? Assim te guio melhor 😉`, "flow/faq"), next: "oferta" };
}
