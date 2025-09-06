// configs/bots/claudia/flow/offer.js
import { callLLM } from '../../../../src/core/llm.js';
import { settings } from '../../../../src/core/settings.js';

function clampPrice(p) {
  const min = Number(settings?.guardrails?.price_min ?? 0);
  const max = Number(settings?.guardrails?.price_max ?? 999999);
  const n = Number(p);
  if (Number.isFinite(n)) return Math.min(Math.max(n, min), max);
  return Number(settings?.product?.price_target ?? 170);
}
function sanitizeLinks(text) {
  const strict = !!settings?.guardrails?.allow_links_only_from_list;
  if (!strict) return text;
  const allowed = (settings?.guardrails?.allowed_links || [])
    .map(s => String(s).trim())
    .filter(Boolean)
    .map(a => a.replace('{{checkout_link}}', settings?.product?.checkout_link || ''));
  if (!allowed.length) return text.replace(/https?:\/\/\S+/gi, '');
  return text.replace(/https?:\/\/\S+/gi, (m) => (allowed.some(a => m.includes(a)) ? m : ''));
}

export async function offer({ userId, text }) {
  const priceTarget = clampPrice(settings?.product?.price_target ?? 170);
  const checkout = String(settings?.product?.checkout_link || '').trim();
  const templates = (settings?.messages?.offer_templates || [
    "Com base no que você me falou, recomendo o kit por R${{price_target}} 🛒 Posso te passar o link do checkout agora?",
  ]).filter(t => !/\{\{coupon_code\}\}/i.test(t)); // remove sugestões com cupom

  const prompt = `
Dados do produto:
- Preço alvo: R$ ${priceTarget}
- Checkout: ${checkout || '(definir no settings.yaml)'}
Regras:
- NÃO mencione cupom na oferta.
- Não invente valores fora do range ${settings?.guardrails?.price_min ?? '?'}–${settings?.guardrails?.price_max ?? '?'}.
- Só inclua link se estiver em "allowed_links" (senão, peça autorização para enviar).
- Máx 2 linhas. Tom vendedor.

Sugestões de copy:
${templates.map(t => `• ${t}`).join('\n')}
`;

  const { text: llm } = await callLLM({
    stage: 'oferta',
    system: `Você é ${settings?.persona_name || 'Cláudia'}, vendedora confiante.
Ofereça o produto com clareza e CTA (pergunte se pode enviar o link). Não fale de cupom.`,
    prompt,
  });

  const out = (llm || '').replace(/\{\{price_target\}\}/g, String(priceTarget))
                         .replace(/\{\{checkout_link\}\}/g, checkout || '');
  return sanitizeLinks(out).trim() || `Consigo por R$${priceTarget}. Posso te mandar o link do checkout agora?`;
}
