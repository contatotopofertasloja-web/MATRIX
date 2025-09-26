// configs/bots/claudia/flow/objections.js
// Tratamento de objeções comuns (preço, alergia, parcelamento, hesitação)
// Agora usando memória unificada (recall/remember) para personalizar com nome/perfil.

import { callUser, tagReply, normalizeSettings } from "./_state.js";
import { recall, remember } from "../../../../src/core/memory.js";

function rx(s) { return new RegExp(s, "i"); }

export function match(text = "", _settings = {}) {
  const t = String(text || "").toLowerCase();
  return /(car[oa]|caro|preç|valor|alerg|reação|sens[ií]vel|parcel|divid|vou pensar|depois|ainda n[aã]o)/i.test(t);
}

export default async function objections(ctx) {
  const { jid, text = "", state = {}, settings = {} } = ctx;
  const S = normalizeSettings(settings);
  state.turns = (state.turns || 0) + 1;
  const t = text.toLowerCase();

  // carrega perfil salvo em memória unificada
  try {
    const saved = await recall(jid);
    if (saved?.profile) {
      state.profile = { ...(state.profile || {}), ...saved.profile };
    }
  } catch (e) {
    console.warn("[objections.recall]", e?.message);
  }

  if (rx("car[oa]|caro|preç|valor").test(t)) {
    return {
      reply: tagReply(
        S,
        `Te entendo, ${callUser(state)}. A diferença é que você **paga só quando recebe** (COD) e tem **7 dias** pra sentir o resultado — sem burocracia. ` +
          `Se não amar, devolvemos. Quer que eu **adicione seus dados** e te envio o resumo pra confirmar?`,
        "flow/objections"
      ),
      next: "fechamento",
    };
  }

  if (rx("alerg|reação|sens[ií]vel").test(t)) {
    return {
      reply: tagReply(
        S,
        `Ótima pergunta. Eu sempre recomendo um **teste de mecha** antes da aplicação completa, tá? ` +
          `Aplica numa pequena área, aguarda e observa. Se quiser, te envio o passo a passo depois da compra.`,
        "flow/objections"
      ),
      next: "oferta",
    };
  }

  if (rx("parcel|divid").test(t)) {
    return {
      reply: tagReply(
        S,
        `A gente trabalha forte com **COD** (super prático). Se preferir parcelar, dá pra fazer **parcelado** no site — ` +
          `mas eu consigo adiantar seu **COD** agora e você paga só ao receber. Te adianto?`,
        "flow/objections"
      ),
      next: "fechamento",
    };
  }

  if (rx("vou pensar|depois|mais tarde|ainda n[aã]o").test(t)) {
    return {
      reply: tagReply(
        S,
        `Combinado, ${callUser(state)} 💖. Posso te deixar um **resumo** com tudo certinho (benefícios, modo de uso e garantia) ` +
          `e, quando quiser, a gente conclui. Prefere assim?`,
        "flow/objections"
      ),
      next: "oferta",
    };
  }

  return {
    reply: tagReply(
      S,
      `Sem problemas! Me diz só o que te deixou na dúvida que eu te ajudo rapidinho.`,
      "flow/objections"
    ),
    next: "qualificacao",
  };
}
