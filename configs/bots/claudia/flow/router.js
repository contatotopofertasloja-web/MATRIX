// configs/bots/claudia/flow/router.js
// Prioridade: pós-venda → fechamento → FAQ → oferta → objeções → qualificação → saudação.

import greet from './greet.js';
import qualify from './qualify.js';
import offer from './offer.js';
import objections, { match as objectionsMatch } from './objections.js';
import close from './close.js';
import postsale from './postsale.js';
import faq, { match as faqMatch } from './faq.js';

function stripAccents(s = '') { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function clean(t = '') { return stripAccents(String(t || '').toLowerCase()).replace(/\s+/g, ' ').trim(); }

export function pickFlow(text = '', _settings = {}, state = {}) {
  const t = clean(text);

  // 0) stickiness: se está no fechamento, fica, salvo cancelamento explícito
  if (state?.stage === 'fechamento' && !/\b(cancelar|voltar|mudar|n[aã]o quero)\b/i.test(t)) return close;

  // 1) Pós-venda
  if (/\b(paguei|comprovante|finalizei|comprei|pedido feito|pago)\b/i.test(t)) return postsale;

  // 2) Fechamento (checkout/link)
  if (/\b(checkout|finalizar|finaliza(r)?|fechar|comprar|carrinho|link)\b/i.test(t)) return close;

  // 3) FAQ determinístico (inclui entrega/pagamento)
  try { if (typeof faqMatch === 'function' && faqMatch(text, _settings)) return faq; } catch {}

  // 4) Oferta (preço)
  if (/\b(pre[cç]o|valor|quanto\s*custa|promo[cç][aã]o|oferta|cust[ao])\b/i.test(t)) return offer;

  // 5) Objeções
  try { if (typeof objectionsMatch === 'function' && objectionsMatch(text, _settings)) return objections; } catch {}

  // 6) Qualificação por sinais de cabelo
  if (/\b(liso|ondulado|cachead[oa]|crespo|frizz|volume)\b/i.test(t)) return qualify;

  // 7) Saudação
  if (/\b(oi|ol[áa]|bom\s*dia|boa\s*tarde|boa\s*noite|hey|hi|hello)\b/i.test(t)) return greet;

  return qualify;
}
