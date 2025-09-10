// configs/bots/claudia/flow/postsale.js
import { callLLM } from '../../../../src/core/llm.js';
import { settings } from '../../../../src/core/settings.js';

/**
 * Pós-venda:
 * - Agradece
 * - Reforça acompanhamento por WhatsApp
 * - Sem cupom (cupom só após confirmação do pagamento via webhook/handler)
 */
export async function postsale({ userId, text }) {
  const msgs = [
    ...(settings?.messages?.postsale_pre_coupon || []),
  ];
  const fallback =
    msgs[0] ||
    'Obrigada pela confiança! Você receberá mensagens no WhatsApp para agendamento e acompanhamento. Qualquer dúvida, me chama aqui ✨';

  const { text: llm } = await callLLM({
    stage: 'postsale',
    system: `Você é ${settings?.persona_name || 'Cláudia'}.
Agradeça, reforce o acompanhamento por WhatsApp e mantenha 1–2 linhas. Sem cupom.`,
    prompt: `Cliente: ${text || '(sem texto)'}\nResponda no tom de pós-venda (curto).`,
  });

  const out = (llm || fallback).trim();
  // Sem links no pós-venda, por política
  return out.replace(/https?:\/\/\S+/gi, '');
}
