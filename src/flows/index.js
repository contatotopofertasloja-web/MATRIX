import OpenAI from 'openai';
import { buildPrompt } from '../prompts/index.js';

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export async function runFlow({message, userId, stage, model = 'gpt-4o-mini'}) {
  const { system, user } = buildPrompt({stage, message});

  // Sem chave -> devolve mock legível (bom para testar e também em deploy sem variável)
  if (!client) {
    return { reply: `[DEV-MOCK] ${system} | Usuário: ${user}`, model, stage, mock: true };
  }

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.6
  });

  const reply = resp.choices?.[0]?.message?.content?.trim() || '...';
  return { reply, model, stage };
}