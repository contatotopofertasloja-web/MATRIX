// configs/bots/claudia/flow/objections.js
import { callUser, tagReply } from "./_state.js";

function rx(s) { return new RegExp(s, "i"); }

export function match(text = "", _settings = {}) {
  const t = String(text || "").toLowerCase();
  return /(car[oa]|caro|preç|valor|alerg|reação|sens[ií]vel|parcel|divid|vou pensar|depois|ainda n[aã]o)/i.test(t);
}

export default async function objections(ctx) {
  const { text = "", state, settings } = ctx;
  state.turns = (state.turns || 0) + 1;
  const t = text.toLowerCase();

  if (rx("car[oa]|caro|preç|valor").test(t)) {
    return {
      reply: tagReply(settings,
        `Te entendo, ${callUser(state)}. A diferença é que você **paga só quando recebe** (COD) e tem **7 dias** pra sentir o resultado — sem burocracia. ` +
        `Se não amar, devolvemos. Quer que eu **adicione seus dados** e te envio o resumo pra confirmar?`,
        "flow/objections"
      ),
      next: "fechamento",
    };
  }
  if (rx("alerg|reação|sens[ií]vel").test(t)) {
    return {
      reply: tagReply(settings,
        `Ótima pergunta. Eu sempre recomendo um **teste de mecha** antes da aplicação completa, tá? ` +
        `Aplica numa pequena área, aguarda e observa. Se quiser, te envio o passo a passo depois da compra.`,
        "flow/objections"
      ),
      next: "oferta",
    };
  }
  if (rx("parcel|divid").test(t)) {
    return {
      reply: tagReply(settings,
        `A gente trabalha forte com **COD** (super prático). Se preferir parcelar, dá pra fazer **parcelado** no site — ` +
        `mas eu consigo adiantar seu **COD** agora e você paga só ao receber. Te adianto?`,
        "flow/objections"
      ),
      next: "fechamento",
    };
  }
  if (rx("vou pensar|depois|mais tarde|ainda n[aã]o").test(t)) {
    return {
      reply: tagReply(settings,
        `Combinado, ${callUser(state)} 💖. Posso te deixar um **resumo** com tudo certinho (benefícios, modo de uso e garantia) ` +
        `e, quando quiser, a gente conclui. Prefere assim?`,
        "flow/objections"
      ),
      next: "oferta",
    };
  }

  // fallback amigável
  return {
    reply: tagReply(settings, `Sem problemas! Me diz só o que te deixou na dúvida que eu te ajudo rapidinho.`, "flow/objections"),
    next: "qualificacao",
  };
}
