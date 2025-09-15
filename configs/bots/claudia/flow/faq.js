// configs/bots/claudia/flow/faq.js
// Mantém a lógica atual, mas garante interpolação correta (sem placeholders),
// puxa empresa/horários do settings, e sempre avança o funil com pergunta.

import { callUser, getFixed } from "./_state.js";

function norm(s = "") {
  return String(s || "").toLowerCase();
}

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

  // --- Produto (nome) ---
  if (/nome do produto|qual\s*é\s*o\s*produto|como\s*se\s*chama\s*o\s*produto/.test(t)) {
    const nm = settings?.product?.name || "Progressiva X";
    return {
      reply: `O nome do produto é **${nm}**. Quer que eu te explique rapidinho como ele funciona?`,
      next: "oferta",
    };
  }

  // --- Empresa ---
  if (/empresa|voc[eê]s s[aã]o quem|nome da empresa/.test(t)) {
    const empresa = settings?.company?.name || fx?.empresa || "TopOfertas";
    return {
      reply: `Somos a **${empresa}** 🧡. Posso te ajudar a decidir se ele combina com seu cabelo?`,
      next: "oferta",
    };
  }

  // --- Horários ---
  if (/hor[aá]rio|atendem|funciona at[eé] quando|que horas voc[eê]s abrem|fecha/.test(t)) {
    const hours = settings?.company?.hours || fx?.hora || "06:00–21:00";
    return {
      reply: `Atendemos **${hours} (BRT)**, ${callUser(state)}. Quer aproveitar e tirar uma dúvida agora?`,
      next: "oferta",
    };
  }

  // --- Sorteio / brinde ---
  if (/sorteio|brinde|premi/.test(t)) {
    const on = fx?.sorteioOn === true || settings?.promotions?.raffle?.enabled === true;
    const teaser = on
      ? (settings?.promotions?.raffle?.teaser ||
         "Comprando este mês você participa do nosso sorteio de prêmios. Quer que eu te explique rapidinho?")
      : "No momento não temos sorteios ativos, mas te aviso se abrir um novo! ✨";
    return { reply: teaser, next: "oferta" };
  }

  // --- Garantia / trocas ---
  if (/garanti|troca|devolu/.test(t)) {
    const g = settings?.product?.refund_days_after_delivery ?? 7;
    return {
      reply: `Você tem **${g} dias** para testar após receber. Se não amar, fazemos a devolução sem burocracia. Quer ver como é o passo a passo de uso?`,
      next: "oferta",
    };
  }

  // --- Aplicação / rendimento / duração ---
  if (/aplica|rende|quantas vezes|dura|mes(es)?/.test(t)) {
    const applications = fx?.applications || "várias aplicações";
    const duration = fx?.duration || "de 2 a 3 meses";
    return {
      reply: `Rende **${applications}** e o efeito costuma durar **${duration}** (varia com os cuidados). Quer que eu te mande o resumo de aplicação?`,
      next: "oferta",
    };
  }

  // --- Volume / frasco ---
  if (/\bml\b|mili|frasco|tamanho/.test(t)) {
    const ml = settings?.product?.volume_ml ?? 500;
    return {
      reply: `O frasco tem **${ml} ml**. Prefere que eu te explique o modo de uso ou já quer avançar para garantir o seu?`,
      next: "oferta",
    };
  }

  // --- Parcelamento / pagamento ---
  if (/parcel|divid/.test(t)) {
    const installments = settings?.payments?.installments;
    const enabled = installments?.enabled !== false;
    const max = installments?.max_installments ?? 12;
    const txt = enabled
      ? `Rola parcelar em **até ${max}x**.`
      : `Trabalhamos forte com **Pagamento na Entrega (COD)** — super prático 😉`;
    return { reply: `${txt} Quer seguir?`, next: "oferta" };
  }

  // --- Áudio ---
  if (/audio|áudio|mandar voz/.test(t)) {
    return { reply: `Pode mandar áudio sim, ${callUser(state)}! Eu te acompanho 💬`, next: "oferta" };
  }

  // Sem correspondência objetiva → volta pra oferta consultiva
  return {
    reply: `Me diz o que mais te incomoda hoje: frizz, volume ou falta de brilho? Assim te guio melhor 😉`,
    next: "oferta",
  };
}
