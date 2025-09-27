// configs/bots/claudia/flow/index.js
// Refeito do ZERO, alinhado ao roteiro validado “OFFER – Fluxo de Vendas – Cláudia”.
// Exporta os handlers por estágio para o flow-loader do core (neutro).
// Mantém carimbos visíveis (cada flow já sai com meta.tag ou [flow/...]).
//
// Stages disponíveis: recepcao (greet), qualificacao, oferta, fechamento, posvenda, features (faq), objecoes.

import greet from "./greet.js";
import qualify from "./qualify.js";
import offer from "./offer.js";
import close from "./close.js";
import postsale from "./postsale.js";
import faq from "./faq.js";
import objections from "./objections.js";

// Mapa de handlers por stage (o core usa stageFromIntent/intentOf para escolher)
export const handlers = {
  recepcao: greet,
  greet, // alias
  qualificacao: qualify,
  oferta: offer,
  fechamento: close,
  posvenda: postsale,
  features: faq,
  objecoes: objections,
};

// Fallback genérico: se o core chamar ".handle" por engano, vamos de qualify→offer
export async function handle(ctx = {}) {
  const t = String(ctx?.text || "").toLowerCase();
  if (/pre[cç]o|valor|quanto|cust/.test(t)) return offer(ctx);
  if (/link|checkout|compr(ar|a)|finaliza/.test(t)) return close(ctx);
  if (/entrega|prazo|frete/.test(t)) return faq(ctx);
  if (/caro|alerg|parcel|vou pensar|depois/.test(t)) return objections(ctx);
  return qualify(ctx);
}

export default handlers;
