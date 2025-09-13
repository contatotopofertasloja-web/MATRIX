// Pós-venda curto, humano, sem links/cupom (cupom vem via webhook de pagamento)
import { callLLM } from '../../../../src/core/llm.js';
import { settings } from '../../../../src/core/settings.js';

export async function postsale({ userId, text }) {
  const teaserSorteio = settings?.sweepstakes?.enabled
    ? (settings?.messages?.sweepstakes_teaser || 'Ah! E com o seu pedido você entra no sorteio do mês 🎁')
    : '';

  const msgs = [
    ...(settings?.messages?.postsale_pre_coupon || []),
    `Obrigada pela confiança! 💛 Vou te acompanhando por aqui no WhatsApp sobre a entrega. ${teaserSorteio}`.trim()
  ].filter(Boolean);

  const fallback = msgs[0];

  const { text: llm } = await callLLM({
    stage: 'postsale',
    system:
`Você é ${settings?.persona_name || 'Cláudia'} (tom amiga, 1–2 linhas, sem links).
Agradeça a compra e diga que acompanhará por WhatsApp (entrega/atualizações).
Se houver sorteio ativo, mencione rapidamente (sem link). Sem cupom.`,
    prompt:
`Cliente: ${text || '(sem texto)'}
Responda em 1–2 linhas. Sem links.`
  });

  return (llm || fallback).trim().replace(/https?:\/\/\S+/gi, '');
}
