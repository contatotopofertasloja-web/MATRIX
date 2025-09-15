// Intenções: greet | qualify | offer | objection | close | postsale | delivery | payment | features
// Inclui detecção de compra, negatividade, agradecimentos e fallback seguro.

function stripAccents(s = '') {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function clean(text = '') {
  return stripAccents(String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim());
}

const RX = {
  // Pós-venda / confirmação de pagamento
  postsale: /\b(paguei|pagamento\s*feito|pago|comprovante|finalizei|finalizado)\b/i,

  // Fechamento (checkout)
  close: /\b(fechar|checkout|finalizar|comprar|link|pedido|carrinho)\b/i,

  // Oferta / preço
  offer: /\b(oferta|promo[cç][aã]o|desconto|pre[cç]o|valor|quanto|cust[ao])\b/i,

  // Objeções / hesitações
  objection: /\b(caro|car[oa]|duvid[ao]|medo|receio|ruim|n[aã]o\s*sei|depois|piorar|estragar)\b/i,

  // Logística / pagamento / features
  delivery: /\b(entrega|prazo|frete|correio|log[ií]stica|transportadora)\b/i,
  payment: /\b(pagamento|cart[aã]o|boleto|pix|parcelar|cr[eé]dito|d[eé]bito|cod)\b/i,
  features: /\b(como\s*usar|aplicar|aplica[cç][aã]o|modo\s*de\s*uso|passo\s*a\s*passo|ingrediente|composi[cç][aã]o)\b/i,

  // Qualificação sobre o cabelo
  qualify: /\b(liso|ondulado|cacheado|crespo|frizz|volume|oleoso|ressecado|qu[ií]mica|alisar|progressiva)\b/i,

  // Saudação
  greet: /\b(oi|ol[áa]|bom\s*dia|boa\s*tarde|boa\s*noite|hey|hi|hello)\b/i,

  // Negatividade / xingamentos
  negative: /\b(burro|retardad|bosta|merda|idiot|est[uú]pid|odiei|ruim|horr[ií]vel|lixo)\b/i,

  // Agradecimentos / small talk
  smalltalk: /\b(obrigad|valeu|thanks|vlw|tmj|show|perfeito|maravilha)\b/i,
};

export function intentOf(text = '') {
  const t = clean(text);
  if (!t) return 'greet';

  if (RX.postsale.test(t))  return 'postsale';
  if (RX.close.test(t))     return 'close';
  if (RX.offer.test(t))     return 'offer';
  if (RX.objection.test(t)) return 'objection';
  if (RX.delivery.test(t))  return 'delivery';
  if (RX.payment.test(t))   return 'payment';
  if (RX.features.test(t))  return 'features';
  if (RX.qualify.test(t))   return 'qualify';
  if (RX.greet.test(t))     return 'greet';
  if (RX.negative.test(t))  return 'objection';
  if (RX.smalltalk.test(t)) return 'greet';

  return 'greet';
}
export default { intentOf };
