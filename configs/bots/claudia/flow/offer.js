// configs/bots/claudia/flow/offer.js
import { callLLM } from '../../../../src/core/llm.js';
import { settings } from '../../../../src/core/settings.js';
import { getSlot, setStage } from '../../../../src/core/fsm.js';
import { intentOf } from '../../../../src/core/intent.js';

// --- helpers (mantidos/estendidos) ---
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
  // Se o cliente já pedir direto o link/fechamento, pulamos pro fechamento
  const wantClose = ['close'].includes(intentOf(text));
  if (wantClose) {
    await setStage(userId, 'fechamento');
    return 'Perfeito, já posso te enviar o link do checkout. Posso mandar agora?';
  }

  const priceTarget = clampPrice(settings?.product?.price_target ?? 170);
  const checkout = String(settings?.product?.checkout_link || '').trim();
  const templates = (settings?.messages?.offer_templates || [
    "Com base no que você me falou, recomendo o kit por R${{price_target}} 🛒 Posso te passar o link do checkout agora?",
  ]).filter(t => !/\{\{coupon_code\}\}/i.test(t)); // sem cupom na oferta

  // Personaliza com os slots (não repete perguntas)
  const tipo = await getSlot(userId, 'tipo_cabelo');
  const objetivo = await getSlot(userId, 'objetivo');
  const quimica = await getSlot(userId, 'tem_quimica');
  const contexto = [
    tipo ? `Cabelo: ${tipo}` : null,
    objetivo ? `Objetivo: ${objetivo}` : null,
    quimica ? `Química: ${quimica}` : null,
  ].filter(Boolean).join(' | ') || '(sem slots)';

  const prompt = `
Cliente: ${contexto}
Preço alvo: R$ ${priceTarget}
Regras:
- NÃO mencione cupom na oferta.
- Máx 2 linhas. Tom vendedor confiante.
- Peça confirmação pra enviar link do checkout (sem colar o link ainda).
Sugestões:
${templates.map(t => `• ${t}`).join('\n')}
`;

  const { text: llm } = await callLLM({
    stage: 'oferta',
    system: `Você é ${settings?.persona_name || 'Cláudia'}, vendedora objetiva.
Ofereça com CTA (pergunte se pode enviar o link). Não fale de cupom.`,
    prompt,
  });

  const out = (llm || '').replace(/\{\{price_target\}\}/g, String(priceTarget))
                         .replace(/\{\{checkout_link\}\}/g, checkout || '');
  await setStage(userId, 'oferta'); // garante stage
  return sanitizeLinks(out).trim() || `Consigo por R$${priceTarget}. Posso te mandar o link do checkout agora?`;
}
