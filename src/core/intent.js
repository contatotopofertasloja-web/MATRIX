// src/core/intent.js — versão aprimorada (Matrix IA 2.0)
// Intenções: greet | qualify | offer | objection | close | post_sale | delivery | payment | features
// Mantém compat com teu intent anterior, mas com mais sinais, prioridades e robustez. 

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

// --- Conjuntos de regex com prioridade (ordem IMPORTA) ---
const RX = {
  // Alta prioridade (eventos "decisivos")
  close: /\b(checkout|finalizar|finaliza(r)?|fechar|fechamento|compra(r)?|carrinho|link\s*(de)?\s*pagamento|manda\s*o\s*link|quero\s*comprar)\b/i,

  // Oferta / preço / desconto (mas sem engolir "close")
  offer: /\b(preco|preço|promoc(ao|ao|ao)?|desconto|oferta|quanto\s*custa|quanto\b|melhor\s*valor|tem\s*desconto)\b/i,

  // Objeções / risco / segurança
  objection: /\b(caro|muito\s*cara|nao\s*funciona|funciona\s*mesmo|duvido|medo|receio|reclamac(ao|oes)|ruim|deu\s*errado|tem\s*formol|faz\s*mal|seguro)\b/i,

  // Pós-venda / suporte / troca
  postsale: /\b(pos[\s-]?venda|posvenda|p(o|ó)s[\s-]?venda|troca|devoluc(ao|ao)|suporte|garantia|assistencia)\b/i,

  // Logística / prazo / frete
  delivery: /\b(cep|frete|prazo|entrega|envio|transportadora|custo\s*de\s*envio|quando\s*chega|chega\s*quando|prazo\s*de\s*entrega|logzz)\b/i,

  // Pagamento / meios / COD
  payment: /\b(pagamento|pagar|pix|cart(ao|ao)|credito|debito|boleto|parcel(a|amento)|cod|na\s*entrega|paga\s*na\s*entrega)\b/i,

  // Características / modo de uso
  features: /\b(como\s*usa|modo\s*de\s*uso|aplicar|aplico|passo\s*a\s*passo|composic(ao|ao)|resultado(s)?|efeito(s)?|registro|anvisa|chapinha)\b/i,
};

// Confirmação explícita de pagamento (para disparar pós-pagamento no handler)
const PAYMENT_CONFIRMED = /\b(paguei|pagamento\s*feito|pago|comprovante|enviei\s*o\s*comprovante|finalizei|finalizado)\b/i;

// Sinais genéricos
const YESNO   = /\b(sim|s|ok|claro|quero|top|manda|pode|vamos|bora|nao|não|talvez)\b/i;
const HELLO   = /\b(oi|ola|ol[áa]|bom\s*dia|boa\s*tarde|boa\s*noite|hey|fala|eai|e\s*a[ií])\b/i;
const QUESTION= /\?|^como\b|^quando\b|^onde\b|^qual(es)?\b|^quanto\b|^por\s*que\b|^porque\b|^pq\b/i;

// Heurística: primeiras mensagens curtas e saudações
function looksLikeFirstTouch(t) {
  return HELLO.test(t) || t.length <= 12;
}

// Export principal
export function intentOf(textRaw) {
  const raw = String(textRaw || '');
  if (!raw.trim()) return 'greet';

  const t = clean(raw);

  // 1) Pagamento confirmado → o handler usa isso para liberar cupom depois
  if (PAYMENT_CONFIRMED.test(t)) return 'post_sale';

  // 2) Prioridade alta
  if (RX.close.test(t))     return 'close';

  // 3) Demais intenções temáticas
  if (RX.delivery.test(t))  return 'delivery';
  if (RX.payment.test(t))   return 'payment';
  if (RX.features.test(t))  return 'features';
  if (RX.objection.test(t)) return 'objection';
  if (RX.postsale.test(t))  return 'post_sale';
  if (RX.offer.test(t))     return 'offer';

  // 4) Heurísticas suaves de funil
  if (HELLO.test(t) || looksLikeFirstTouch(t)) return 'greet';
  if (QUESTION.test(t))                         return 'qualify';
  if (YESNO.test(t))                            return 'offer';

  // 5) Default
  return 'greet';
}
