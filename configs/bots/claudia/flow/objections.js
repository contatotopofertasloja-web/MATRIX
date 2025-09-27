// configs/bots/claudia/flow/objections.js
// Tratamento de objeções (preço, segurança/alergia, parcelamento, hesitação)
// Usa memória unificada (recall/remember) e carimbos em todas as saídas.

import { callUser, tagReply, normalizeSettings } from "./_state.js";
import { recall } from "../../../../src/core/memory.js";

function rx(s) { return new RegExp(s, "i"); }

export function match(text = "") {
  const t = String(text || "").toLowerCase();
  return /(car[oa]|caro|preç|valor|alerg|reação|sens[ií]vel|parcel|divid|vou pensar|depois|ainda n[aã]o)/i.test(t);
}

export default async function objections(ctx = {}) {
  const { jid, text = "", state = {}, settings = {} } = ctx;
  const S = normalizeSettings(settings);
  state.turns = (state.turns || 0) + 1;
  const t = String(text || "").toLowerCase();

  // puxa perfil salvo
  try {
    const saved = await recall(jid);
    if (saved?.profile) state.profile = { ...(state.profile || {}), ...saved.profile };
  } catch {}

  if (rx("car[oa]|caro|preç|valor").test(t)) {
    return {
      reply: tagReply(
        S,
        `Te entendo, ${callUser(state) || "amiga"}. A diferença é que você **paga só quando recebe** (COD) e tem **7 dias** para sentir o resultado — sem burocracia. ` +
        `Se não amar, devolvemos. Quer que eu **adicione seus dados** e te envio o resumo pra confirmar?`,
        "flow/objections#preco"
      ),
      meta: { tag: "flow/objections#preco" },
      next: "fechamento",
    };
  }

  if (rx("alerg|reação|sens[ií]vel|formol").test(t)) {
    return {
      reply: tagReply(
        S,
        `Pode ficar tranquila 💚 É **livre de formol adicionado**. Sempre recomendo **teste de mecha** antes da aplicação completa, especialmente se o couro for sensível. Posso te mandar o passo a passo depois.`,
        "flow/objections#seguranca"
      ),
      meta: { tag: "flow/objections#seguranca" },
      next: "oferta",
    };
  }

  if (rx("parcel|divid|12x|cart[aã]o|cartao").test(t)) {
    const par = S?.payments?.installments_max || 12;
    return {
      reply: tagReply(
        S,
        `No site dá para parcelar em até **${par}x**. No **COD** você paga só quando recebe, bem prático. Prefere que eu adiante pelo **COD** agora?`,
        "flow/objections#parcelamento"
      ),
      meta: { tag: "flow/objections#parcelamento" },
      next: "fechamento",
    };
  }

  if (rx("vou pensar|depois|mais tarde|ainda n[aã]o").test(t)) {
    return {
      reply: tagReply(
        S,
        `Combinado 💖 Posso te deixar um **resumo** com benefícios, modo de uso e garantia. Quando quiser, a gente conclui.`,
        "flow/objections#hesitacao"
      ),
      meta: { tag: "flow/objections#hesitacao" },
      next: "oferta",
    };
  }

  return {
    reply: tagReply(S, `Sem problemas! Me diz só o que te deixou na dúvida que eu te ajudo rapidinho.`, "flow/objections#fallback"),
    meta: { tag: "flow/objections#fallback" },
    next: "qualificacao",
  };
}
