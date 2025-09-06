// configs/bots/claudia/flow/postsale.js
import { callLLM } from '../../../../src/core/llm.js';
import { settings } from '../../../../src/core/settings.js';

export async function postSale({ userId, text }) {
  const msgs = [
    ...(settings?.messages?.postsale_pre_coupon || []),
    // Evite entregar cupom aqui; ele é enviado apenas após confirmação de pagamento pelo handler/webhook.
  ];
  const fallback = msgs[0] || 'Qualquer dúvida no uso me chama aqui, combinado? Posso te mandar uma rotina de manutenção ✨';

  const { text: llm } = await callLLM({
    stage: 'posvenda',
    system: `Você é ${settings?.persona_name || 'Cláudia'}.
Agradeça, reforce que o cliente receberá mensagens por WhatsApp para agendamento/acompanhamento e que, em imprevistos, deve avisar o entregador. 1-2 linhas.`,
    prompt: `Cliente: ${text || '(sem texto)'}\nResponda no tom de pós-venda (sem cupom).`,
  });

  return (llm || fallback).trim();
}
