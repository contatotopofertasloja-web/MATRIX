// configs/bots/claudia/flow/qualify.js
import { callLLM } from '../../../../src/core/llm.js';
import { settings } from '../../../../src/core/settings.js';

export async function qualify({ userId, text }) {
  const followups = settings?.messages?.qualify_followups || [
    'Você já fez progressiva antes? Te incomoda mais o frizz ou o volume?',
    'Prefere resultado bem liso ou só alinhado com brilho?',
  ];

  const { text: reply } = await callLLM({
    stage: 'qualificacao',
    system: `Você é ${settings?.persona_name || 'Cláudia'}, vendedora.
Faça 1 pergunta objetiva para qualificar a necessidade do cliente.
Não ofereça preço ainda. Não envie links. Máx 1-2 linhas.`,
    prompt: `Histórico (última msg): ${text || '(sem texto)'}\n
Sugestões possíveis: ${followups.join(' | ')}\n
Escreva UMA pergunta curta e simpática.`,
  });

  return (reply || followups[0]).trim();
}
