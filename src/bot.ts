// src/bot.ts
// Bot em TypeScript com fallback local + LLM opcional (OpenAI).
// Exports: initBot(), handleMessage() e default { handleMessage, initBot }

import 'dotenv/config';
import OpenAI from 'openai';

type BotContext = Record<string, unknown>;

interface HandleMessageInput {
  userId: string;
  text: string;
  context?: BotContext;
}

const {
  OPENAI_API_KEY,
  MODEL_NAME = 'gpt-4o',
  BOT_ID = 'claudia',
} = process.env;

let openai: OpenAI | null = null;

/**
 * Carrega recursos do bot (prompts/flows/etc). Mantido simples para não travar boot.
 */
async function loadBotSettings(_botId: string): Promise<{ name: string }> {
  // Se quiser, ler YAML/JSON aqui.
  return { name: _botId };
}

/**
 * Inicializa o bot: instancia OpenAI quando houver chave.
 */
export async function initBot(): Promise<boolean> {
  try {
    if (OPENAI_API_KEY && typeof OPENAI_API_KEY === 'string') {
      openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    } else {
      openai = null; // funciona em modo "fallback"
    }
    await loadBotSettings(BOT_ID || 'claudia');
    return true;
  } catch (err: unknown) {
    console.error('[bot][initBot] error:', (err as Error)?.message || err);
    openai = null;
    return false;
  }
}

/**
 * Faz a chamada ao LLM (quando disponível).
 */
async function askLLM(prompt: string): Promise<string> {
  if (!openai) {
    return '';
  }
  try {
    const system = [
      'Você é a Cláudia, vendedora educada e objetiva.',
      'Responda em Português do Brasil.',
      'Se o usuário pedir preço/link sem contexto, faça 1–2 perguntas de qualificação antes de ofertar.',
      'Evite enviar links espontaneamente; ofereça primeiro ajuda guiada.',
    ].join(' ');

    const resp = await openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 300,
    });

    const out =
      resp?.choices?.[0]?.message?.content?.trim() ||
      'Perfeito! Me dá um pouco mais de contexto pra eu te ajudar melhor. 😉';

    return out;
  } catch (err: unknown) {
    console.error('[bot][askLLM] error:', (err as Error)?.message || err);
    return '';
  }
}

/**
 * Manipula a mensagem vinda do adapter de WhatsApp.
 * Retorna SEMPRE string (inclusive em fallback).
 */
export async function handleMessage({ userId, text, context = {} }: HandleMessageInput): Promise<string> {
  const msg = String(text ?? '').trim();

  // Regras rápidas / saudações
  if (!msg) {
    return 'Oi! Sou a Cláudia 👋 Como posso te ajudar hoje?';
  }
  if (/(^|\s)(oi|ol[áa]|bom dia|boa tarde|boa noite)(\s|!|\.|$)/i.test(msg)) {
    return 'Oi! Tudo bem? 😊 Me conta: você já tem em mente o que está buscando?';
  }
  if (/\b(menu|ajuda|help)\b/i.test(msg)) {
    return [
      'Posso ajudar com:',
      '• dúvidas sobre produtos',
      '• status de pedido',
      '• ofertas e condições',
      '• atendimento humano (se preferir)',
      '',
      'O que você precisa?'
    ].join('\n');
  }

  // Tenta LLM; se falhar ou estiver desabilitado, cai no fallback
  const llm = await askLLM(msg);
  if (llm) return llm;

  // Fallback local (sem OpenAI)
  return [
    'Entendi! 👍',
    'Posso te ajudar com dúvidas, ofertas e acompanhamento.',
    'Quer me contar em 1 frase o que você precisa agora?'
  ].join(' ');
}

// Export default para compatibilidade com import default
const BotDefault = { handleMessage, initBot };
export default BotDefault;
