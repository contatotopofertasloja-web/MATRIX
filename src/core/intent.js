// src/core/intent.js — intenções canônicas (neutro)
function stripAccents(s = "") {
  try { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch { return s; }
}
function clean(text = "") {
  return stripAccents(String(text || "")).toLowerCase().replace(/\s+/g, " ").trim();
}
const RX = {
  postsale: /\b(paguei|pagamento\s*feito|pago|comprovante|finalizei|finalizado|comprei|pedido\s*feito)\b/i,
  close: /\b(fechar|checkout|finalizar|comprar|link|pedido|carrinho)\b/i,
  offer: /\b(oferta|promo[cç][aã]o|desconto|pre[cç]o|valor|quanto|cust[ao])\b/i,
  objection: /\b(caro|car[oa]|duvid[ao]|medo|receio|ruim|n[aã]o\s*sei|depois|piorar|estragar)\b/i,
  delivery: /\b(entrega|prazo|frete|correio|log[ií]stica|transportadora|cep)\b/i,
  payment:  /\b(pagamento|cart[aã]o|boleto|pix|parcelar|cr[eé]dito|d[eé]bito|cod|na\s*entrega)\b/i,
  features: /\b(como\s*usar|aplicar|aplica[cç][aã]o|modo\s*de\s*uso|ingrediente|composi[cç][aã]o|ml|tamanho|garantia)\b/i,
  qualify: /\b(frizz|volume|brilho|alisar|progressiva|qu[ií]mica)\b/i, // genérico; sem tipos de cabelo
  greet: /\b(oi|ol[áa]|bom\s*dia|boa\s*tarde|boa\s*noite|hey|hi|hello|obrigad|valeu|thanks|vlw|tmj|show|perfeito|maravilha)\b/i,
  jump: /\b(pular|segue|avança|direto)\b/i,
  confirm: /\b(confirmo|confere|est[aá]\s*certo|ok\s*finaliza)\b/i,
};
export function intentOf(text = "") {
  const t = clean(text);
  if (!t) return "greet";
  if (RX.postsale.test(t))  return "postsale";
  if (RX.close.test(t))     return "close";
  if (RX.offer.test(t))     return "offer";
  if (RX.objection.test(t)) return "objection";
  if (RX.delivery.test(t))  return "delivery";
  if (RX.payment.test(t))   return "payment";
  if (RX.features.test(t))  return "features";
  if (RX.jump.test(t))      return "jump";
  if (RX.confirm.test(t))   return "confirm";
  if (RX.qualify.test(t))   return "qualify";
  if (RX.greet.test(t))     return "greet";
  return "greet";
}
export default { intentOf };
