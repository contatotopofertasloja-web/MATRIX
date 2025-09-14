import { callUser } from "./_state.js";

export default async function objections(ctx) {
  const { text = "", state } = ctx;
  state.turns = (state.turns || 0) + 1;
  const t = text.toLowerCase();

  if (/car[oa]|caro|preç|valor/.test(t)) {
    return {
      reply:
        `Te entendo, ${callUser(state)}. A diferença é que você **paga só quando recebe** (COD) e tem **7 dias** pra sentir o resultado — sem burocracia. ` +
        `Se não amar, devolvemos. Quer que eu **adicione seus dados** e te envio o resumo pra confirmar?`,
      next: "fechamento",
    };
  }
  if (/alerg|reação|sens[ií]vel/.test(t)) {
    return {
      reply:
        `Ótima pergunta. Eu sempre recomendo um **teste de mecha** antes da aplicação completa, tá? ` +
        `Aplica numa pequena área, aguarda e observa. Se quiser, te envio o passo a passo depois da compra.`,
      next: "oferta",
    };
  }
  if (/parcel|divid/.test(t)) {
    return {
      reply:
        `A gente trabalha forte com **COD** (super prático). Se preferir parcelar, dá pra fazer **até 12x** no site — ` +
        `mas eu consigo adiantar seu **COD** agora e você paga só ao receber. Te adianto?`,
      next: "fechamento",
    };
  }
  if (/vou pensar|depois|mais tarde|ainda n[aã]o/.test(t)) {
    return {
      reply:
        `Combinado, ${callUser(state)} 💖. Posso te deixar um **resumo** com tudo certinho (benefícios, modo de uso e garantia) ` +
        `e, quando quiser, a gente conclui. Prefere assim?`,
      next: "oferta",
    };
  }

  return {
    reply: `Qual foi a sua dúvida principal, ${callUser(state)}? Preço, modo de uso, segurança… posso te ajudar em qualquer ponto 😊`,
    next: "oferta",
  };
}
