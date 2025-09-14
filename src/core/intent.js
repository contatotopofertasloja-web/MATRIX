// src/core/intent.js — versão consolidada (Matrix IA 2.0)
// Intenções: greet | qualify | offer | objection | close | post_sale | delivery | payment | features
// Inclui detecção de compra, negatividade, agradecimentos e fallback seguro.

// --- Utils: normalização segura ---
function stripAccents(s = '') {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function clean(text = '') {
  return stripAccents(String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim());
}

// --- Conjuntos de regex com prioridade ---
const RX = {
  // Decisão de compra / fechamento
  close: /\b(checkout|finalizar|finaliza(r)?|fechar|fechamento|compra(r)?|carrinho|link\s*(de)?\s*pagamento|manda\s*o\s*link|quero\s*comprar)\b/i,

  // Oferta / preço / desconto
  offer: /\b(preco|preço|promo(cao|ção)|desconto|oferta|quanto\s*custa|valor|condicao|condição)\b/i,

  // Objeções comuns
  objection_price: /\b(caro|barato|ta\s*cara|mais\s*barato|preco\s*alto)\b/i,
  objection_quality: /\b(funciona|nao\s*funciona|seguro|anvisa|composicao|composição|quimica\s*forte)\b/i,
  objection_delivery: /\b(prazo|demora|entrega|transportadora|quando\s*chega|chegada)\b/i,

  // Pós-venda
  post_sale: /\b(comprovante|paguei|pagamento\s*feito|pix|boleto|nota\s*fiscal)\b/i,

  // FAQ: entrega / pagamento / uso / features
  delivery: /\b(entrega|prazo|frete|correio|logistica)\b/i,
  payment: /\b(pagamento|cartao|boleto|pix|parcelar|credito|débito)\b/i,
  features: /\b(como\s*usar|aplicar|aplicacao|modo\s*de\s*uso|passo\s*a\s*passo|ingrediente|composição)\b/i,

  // Qualificação (cabelo)
  qualify: /\b(liso|ondulado|cacheado|crespo|frizz|volume|oleoso|ressecado|quimica|química|alisar|progressiva)\b/i,

  // Saudação
  greet: /\b(oi|ol[áa]|bom\s*dia|boa\s*tarde|boa\s*noite|hey|hi|hello)\b/i,

  // Negatividade / xingamentos
  negative: /\b(burro|retardad|bosta|merda|idiot|est[uú]pid|odiei|ruim|horr[ií]vel|lixo)\b/i,

  // Agradecimentos / small talk
  smalltalk: /\b(obrigad|valeu|thanks|ok|👍|👌|😊|haha|kkk)\b/i,
};

// --- Função principal ---
export function intentOf(text) {
  const t = clean(text);

  if (!t) return 'smalltalk';

  if (RX.close.test(t)) return 'close';
  if (RX.offer.test(t)) return 'offer';
  if (RX.objection_price.test(t)) return 'objection.price';
  if (RX.objection_quality.test(t)) return 'objection.quality';
  if (RX.objection_delivery.test(t)) return 'objection.delivery';
  if (RX.post_sale.test(t)) return 'post_sale';
  if (RX.delivery.test(t)) return 'faq.delivery';
  if (RX.payment.test(t)) return 'faq.payment';
  if (RX.features.test(t)) return 'faq.features';
  if (RX.qualify.test(t)) return 'qualify';
  if (RX.greet.test(t)) return 'greet';
  if (RX.negative.test(t)) return 'negative';
  if (RX.smalltalk.test(t)) return 'smalltalk';

  // fallback padrão
  return 'qualify';
}

export default intentOf;
