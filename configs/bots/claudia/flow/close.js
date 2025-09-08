// configs/bots/claudia/flow/close.js
import { callLLM } from '../../../../src/core/llm.js';
import { settings } from '../../../../src/core/settings.js';

function onlyAllowedLink(link) {
  const strict = !!settings?.guardrails?.allow_links_only_from_list;
  const allowed = (settings?.guardrails?.allowed_links || [])
    .map(s => s.replace('{{checkout_link}}', settings?.product?.checkout_link || ''))
    .filter(Boolean);
  if (!strict) return link;
  return allowed.some(a => String(link).includes(a)) ? link : '';
}

export async function closeDeal({ userId, text }) {
  const price = settings?.product?.price_target ?? 170;
  const rawCheckout = String(settings?.product?.checkout_link || '').trim();
  const checkout = onlyAllowedLink(rawCheckout);
  const closingLines = settings?.messages?.closing || [
    'Perfeito! Te envio o link do checkout e seguimos por aqui 😉'
  ];

  const fallback = checkout
    ? `Aqui está seu link seguro: ${checkout}\nValor: R$${price}. Pagamento na entrega (COD). Você receberá mensagens no WhatsApp para agendamento e acompanhamento; se houver qualquer imprevisto, avise o entregador 💖`
    : `${closingLines[0]}\nPagamento na entrega (COD). Você receberá mensagens no WhatsApp para agendamento e acompanhamento; se houver qualquer imprevisto, avise o entregador 💖`;

  const { text: llm } = await callLLM({
    stage: 'fechamento',
    system: `Você é ${settings?.persona_name || 'Cláudia'}.
Fechamento objetivo (1–2 linhas). Se houver link permitido, inclua.
Reforce COD e o aviso de agendamento/acompanhamento por WhatsApp. Sem cupom.`,
    prompt: `Cliente: ${text || '(sem texto)'}\nFinalize a compra agora.`,
  });

  const out = (llm || fallback).trim();

  // Último saneamento de link (se por acaso o LLM inventar outro)
  if (!checkout) {
    return out.replace(/https?:\/\/\S+/gi, '');
  }
  return out;
}
