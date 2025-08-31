//src/llm.js
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Modelos por fase do funil (podem ser trocados por variáveis de ambiente no Railway)
const funnelModels = {
  greet: process.env.MODEL_GREET || "gpt-4o-mini",
  qualify: process.env.MODEL_QUALIFY || "gpt-4o",
  offer: process.env.MODEL_OFFER || "gpt-4o",
  objection: process.env.MODEL_OBJECTION || "gpt-4.1",
  close: process.env.MODEL_CLOSE || "gpt-4o",
  post_sale: process.env.MODEL_POSTSALE || "gpt-4o-mini",
};

export function resolveModel(intent) {
  return funnelModels[intent] || process.env.MODEL_NAME || "gpt-4o";
}

export async function chatWithModel(intent, messages, opts = {}) {
  const model = resolveModel(intent);
  const started = Date.now();

  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 512
  });

  const latencyMs = Date.now() - started;
  const answer = completion?.choices?.[0]?.message?.content ?? "";

  return { answer, model, latencyMs, raw: completion };
}
