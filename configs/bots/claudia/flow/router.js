// configs/bots/claudia/flow/router.js
// Prioridade: pós-venda → fechamento → FAQ → oferta → objeções → qualificação → saudação.
// Consulta memória persistente para manter “stickiness” de estágio.

import greet from "./greet.js";
import qualify from "./qualify.js";
import offer from "./offer.js";
import objections, { match as objectionsMatch } from "./objections.js";
import close from "./close.js";
import postsale from "./postsale.js";
import faq, { match as faqMatch } from "./faq.js";
import { recall } from "../../../../src/core/memory.js";

function stripAccents(s = "") {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function clean(t = "") {
  return stripAccents(String(t || "").toLowerCase()).replace(/\s+/g, " ").trim();
}

export async function pickFlow(text = "", _settings = {}, state = {}, jid = "") {
  const t = clean(text);

  // memória
  if (jid) {
    try {
      const saved = await recall(jid);
      if (saved) state = { ...(saved || {}), ...(state || {}) };
    } catch {}
  }

  // fechamento persiste
  if (state?.stage === "fechamento" && !/\b(cancelar|voltar|mudar|n[aã]o quero)\b/i.test(t)) {
    return close;
  }

  if (/\b(paguei|comprovante|finalizei|comprei|pedido feito|pago)\b/i.test(t)) return postsale;
  if (/\b(checkout|finalizar|finaliza(r)?|fechar|comprar|carrinho|link)\b/i.test(t)) return close;

  try { if (typeof faqMatch === "function" && faqMatch(text, _settings)) return faq; } catch {}

  if (/\b(pre[cç]o|valor|quanto\s*custa|promo[cç][aã]o|oferta|cust[ao])\b/i.test(t)) return offer;

  try { if (typeof objectionsMatch === "function" && objectionsMatch(text, _settings)) return objections; } catch {}

  if (/\b(liso|ondulado|cachead[oa]|crespo|frizz|volume|brilho|alisar)\b/i.test(t)) return qualify;

  if (/\b(oi|ol[áa]|bom\s*dia|boa\s*tarde|boa\s*noite|hey|hi|hello)\b/i.test(t)) return greet;

  return qualify;
}
