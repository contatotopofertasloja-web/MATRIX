// configs/bots/claudia/flow/qualify.js
import { callLLM } from '../../../../src/core/llm.js';
import { settings } from '../../../../src/core/settings.js';

/**
 * Qualificação:
 * - Faz 1 pergunta objetiva
 * - Não envia preço, link, nem cupom
 */
export async function qualify({ userId, text }) {
  const followups = settings?.messages?.qualify_followups || [
    'Você já fez progressiva antes? Te incomoda mais o frizz ou o volume?',
    'Prefere resultado bem liso ou só alinhado com brilho?',
  ];

  const { text: reply } = await callLLM({
    stage: 'qualificacao',
    system: `Você é ${settings?.persona_name || 'Cláudia'}, vendedora.
Faça APENAS 1 pergunta objetiva para qualificar a necessidade do cliente.
Sem preço, sem links, sem cupom. Máx 1–2 linhas, tom simpático.`,
    prompt: `Última mensagem do cliente: ${text || '(sem texto)'}
Sugestões (use só como ideia): ${followups.join(' | ')}
Escreva UMA pergunta curta.`,
  });

  const out = (reply || followups[0]).trim();
  // Remove URLs por segurança
  const clean = out.replace(/https?:\/\/\S+/gi, '');
  return clean;
}
