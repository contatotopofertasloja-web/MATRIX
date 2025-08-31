// configs/bots/claudia/flow/postsale.js
import { callLLM } from '../../../../src/core/llm.js';
import { settings } from '../../../../src/core/settings.js';

export async function postSale({ userId, text }) {
  const msgs = settings?.messages?.postsale || [
    'Qualquer dúvida no uso me chama aqui, combinado? Posso te mandar uma rotina de manutenção ✨'
  ];

  const { text: llm } = await callLLM({
    stage: 'posvenda',
    system: `Você é ${settings?.persona_name || 'Cláudia'}.
Agradeça a compra, ofereça orientação de uso e convide a compartilhar resultado. 1-2 linhas.`,
    prompt: `Cliente: ${text || '(sem texto)'}\nResponda no tom de pós-venda.`,
  });

  return (llm || msgs[0]).trim();
}
