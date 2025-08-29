// src/core/intent.js
//
// Engine simples de intents via regex.
// Depois podemos evoluir p/ embeddings.

export function intentOf(text) {
  const t = (text || '').toLowerCase().trim();

  if (/^(oi|olá|ola|bom dia|boa tarde|boa noite)\b/.test(t)) return 'greet';
  if (/(frizz|volume|alinhamento|cabelo|cachead|ondulad|liso|crespo)/.test(t)) return 'qualify';
  if (/(preço|valor|quanto|custa|r\$|\d+,\d{2})/.test(t)) return 'offer';
  if (/(comprar|fechar|link|checkout|quero|finalizar)/.test(t)) return 'close';
  if (/(paguei|comprovante|enviei|pago|pedido)/.test(t)) return 'post_sale';

  if (/(entrega|prazo|frete|dias|chega)/.test(t)) return 'delivery';
  if (/(pagamento|pix|cart[aã]o|boleto|cod|contra entrega)/.test(t)) return 'payment';
  if (/(como usa|modo de uso|aplicar|aplicação)/.test(t)) return 'features';
  if (/(caro|confian[çc]a|anvisa|medo|golpe)/.test(t)) return 'objection';

  return 'other';
}
