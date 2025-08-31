// src/core/intent.js

const RX = {
  delivery:  /\b(cep|frete|prazo|entrega|envio|transportadora|custo de envio)\b/i,
  payment:   /\b(pagamento|pix|cart(ão|ao)|boleto|parcel(a|amento)|cod|na entrega)\b/i,
  features:  /\b(como usa|modo de uso|composição|tem formol|resultados?|garantia|registro|anvisa|efeitos?)\b/i,
  objection: /\b(caro|não funciona|funciona mesmo|duvido|medo|receio|reclamaç(ão|oes)|ruim|deu errado)\b/i,
  offer:     /\b(preço|promo(ção)?|desconto|oferta|cupom|quanto)\b/i,
  close:     /\b(compra(r)?|fechar|checkout|finalizar|link|carrinho)\b/i,
  postsale:  /\b(pos[- ]?venda|pós[- ]?venda|troca|devolu(ç|c)ão|suporte|garantia)\b/i,
};

const YESNO = /\b(sim|s|ok|claro|quero|top|manda|pode|vamos|bora|não|nao|talvez)\b/i;
const QUESTION = /\?|\b(como|quando|onde|qual|quais|quanto|por que|porque|pq)\b/i;

export function intentOf(textRaw) {
  const t = String(textRaw || '').trim();
  if (!t) return 'greet';

  if (RX.delivery.test(t))  return 'delivery';
  if (RX.payment.test(t))   return 'payment';
  if (RX.features.test(t))  return 'features';
  if (RX.objection.test(t)) return 'objection';
  if (RX.offer.test(t))     return 'offer';
  if (RX.close.test(t))     return 'close';
  if (RX.postsale.test(t))  return 'post_sale';

  // funil padrão
  if (/oi|ol[áa]|bom dia|boa (tarde|noite)|hey|fala/i.test(t)) return 'greet';
  if (QUESTION.test(t))     return 'qualify';
  if (YESNO.test(t))        return 'offer';

  return 'greet';
}
