// configs/bots/claudia/flow/index.js
// Handlers da Cláudia + roteador por estado (__route) com prioridade.

import greet from "./greet.js";
import qualify from "./qualify.js";
import offer from "./offer.js";
import close from "./close.js";
import postsale from "./postsale.js";
import faq from "./faq.js";
import objections from "./objections.js";

// === Router por estado (PRIORITÁRIO) ===
export async function __route(ctx = {}) {
  const stage = String(ctx?.state?.stage || "");
  if (!stage) return null;

  if (stage.startsWith("offer."))     return "offer";
  if (stage.startsWith("close.") || stage.startsWith("fechamento.")) return "close";
  if (stage.startsWith("postsale.") || stage.startsWith("post_sale.")) return "postsale";
  return null;
}

// === Mapa de handlers por stage ===
export const handlers = {
  recepcao: greet,
  greet,
  qualificacao: qualify,
  oferta: offer,
  fechamento: close,
  posvenda: postsale,
  features: faq,
  objecoes: objections,
};

// === Fallback leve por intenção ===
export async function handle(ctx = {}) {
  const t = String(ctx?.text || "").toLowerCase();
  if (/pre[cç]o|valor|quanto|cust/.test(t)) return offer(ctx);
  if (/\blink|checkout|compr(ar|a)|finaliza(r)?/.test(t)) return close(ctx);
  if (/entrega|prazo|frete/.test(t)) return faq(ctx);
  if (/caro|alerg|parcel|vou pensar|depois/.test(t)) return objections(ctx);
  return qualify(ctx);
}

export default handlers;
