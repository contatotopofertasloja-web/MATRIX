import { callUser, getFixed } from "./_state.js";

export function match(text = "", settings = {}) {
  const t = String(text || "").toLowerCase();
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
  const t = text.toLowerCase();

  if (/nome do produto|qual\s*é\s*o\s*produto|como\s*se\s*chama\s*o\s*produto/.test(t)) {
    const nm = settings?.product?.name || "Progressiva X";
    return { reply: `O nome do produto é **${nm}**.`, next: "oferta" };
  }

  if (/empresa|voc[eê]s s[aã]o quem|nome da empresa/.test(t))
    return { reply: `Somos a **${fx.empresa}** 🧡`, next: "oferta" };

  if (/hor[aá]rio|atendem|funciona at[eé] quando|que horas voc[eê]s abrem|fecha/.test(t))
    return { reply: `Atendemos **${fx.hora} (BRT)**, ${callUser(state)} — equipe em escala flexível nesse intervalo.`, next: "oferta" };

  if (/sorteio|brinde|premi/.test(t))
    return { reply: fx.sorteioOn ? fx.sorteioTeaser : "No momento não temos sorteios ativos, mas te aviso se abrir um novo! ✨", next: "oferta" };

  if (/garanti|troca|devolu/.test(t))
    return { reply: `Você tem **7 dias** após o pagamento pra testar, ${callUser(state)}. Se não amar, devolvemos sem burocracia.`, next: "oferta" };

  if (/aplica|rende|quantas vezes|dura|mes(es)?/.test(t))
    return { reply: `Rende **${fx.applications}** e dura **${fx.duration}** (varia com cuidados).`, next: "oferta" };

  if (/\bml\b|mili|frasco|tamanho/.test(t))
    return { reply: `O frasco tem **${settings?.product?.volume_ml ?? 500} ml**.`, next: "oferta" };

  if (/parcel|divid/.test(t)) {
    const on = settings?.payments?.installments?.enabled !== false;
    return {
      reply: on
        ? `Rola parcelar em **até ${settings?.payments?.installments?.max_installments ?? 12}x**, ${callUser(state)}.`
        : `Trabalhamos forte com **COD** (paga só ao receber) — super prático 😉`,
      next: "oferta",
    };
  }

  if (/audio|áudio|mandar voz/.test(t))
    return { reply: `Pode mandar áudio sim, ${callUser(state)}! Eu te acompanho 💬`, next: "oferta" };

  return { reply: null, next: "oferta" };
}
