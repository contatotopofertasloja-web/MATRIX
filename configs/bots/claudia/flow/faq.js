import { callUser, getFixed } from "./_state.js";

export default async function faq(ctx) {
  const { text = "", settings, state } = ctx;
  state.turns = (state.turns || 0) + 1;

  const fx = getFixed(settings);
  const t = text.toLowerCase();

  if (/empresa|voc[eê]s s[aã]o quem|nome da empresa/.test(t))
    return { reply: `Somos a **${fx.empresa}** 🧡`, next: "oferta" };

  if (/hor[aá]rio|atendem|funciona at[eé] quando/.test(t))
    return { reply: `Atendemos **${fx.hora} (BRT)**, ${callUser(state)}.`, next: "oferta" };

  if (/sorteio|brinde|premi/.test(t) && fx.sorteioOn)
    return { reply: fx.sorteioTeaser, next: "oferta" };

  if (/garanti|troca|devolu/.test(t))
    return { reply: `Você tem **7 dias** após o pagamento pra testar, ${callUser(state)}. Se não amar, devolvemos sem burocracia.`, next: "oferta" };

  if (/aplica|rende|quantas vezes|dura|mes(es)?/.test(t))
    return { reply: `Rende **${fx.applications}** e dura **${fx.duration}** (varia com cuidados).`, next: "oferta" };

  if (/ml|mili|frasco|tamanho/.test(t))
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
