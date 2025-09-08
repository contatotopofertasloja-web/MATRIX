// src/model.js
// Compat layer para chamadas com TOOLS e/ou response_format (json).
// Mantém a API chat(messages, { stage, tools, responseFormat, temperature, maxTokens }).

import OpenAI from 'openai';
import { pickModelForStage } from './core/llm.js'; // fonte única de verdade
import { settings } from './core/settings.js';

// -------- ENV defaults --------
const RETRIES = Number.isFinite(+process.env.LLM_RETRIES) ? +process.env.LLM_RETRIES : 2;
const TIMEOUT_MS = Number.isFinite(+process.env.LLM_TIMEOUT_MS) ? +process.env.LLM_TIMEOUT_MS : 25000;

// -------- OpenAI client (lazy) --------
let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

// -------- (LEGADO) MODELS_BY_STAGE_JSON como último fallback --------
function parseModelsByStageJSON() {
  try {
    const raw = process.env.MODELS_BY_STAGE_JSON || '{}';
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) {
    console.warn('[model] MODELS_BY_STAGE_JSON inválido:', e?.message || e);
    return {};
  }
}

// Em último caso, se pickModelForStage não existir/errar:
function legacyPick(stageRaw) {
  const map = parseModelsByStageJSON();
  const key = String(stageRaw || '').trim();
  if (key && map[key]) return map[key];
  return process.env.MODEL_NAME || 'gpt-4o';
}

// -------- Tools helpers --------
function toOpenAITools(tools) {
  if (!tools) return undefined;
  return Object.keys(tools).map((name) => ({
    type: 'function',
    function: {
      name,
      description: `Ferramenta ${name}`,
      parameters: { type: 'object', properties: {}, additionalProperties: true },
    },
  }));
}

async function runToolCalls(toolCalls = [], tools = {}) {
  const toolMessages = [];
  for (const call of toolCalls) {
    try {
      const fnName = call.function?.name;
      const fn = tools?.[fnName];
      const args = JSON.parse(call.function?.arguments || '{}');
      if (!fn) {
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: `tool "${fnName}" não implementada` }),
        });
        continue;
      }
      const result = await fn(args);
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result ?? { ok: true }),
      });
    } catch (e) {
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({ ok: false, error: e?.message || String(e) }),
      });
    }
  }
  return toolMessages;
}

// -------- Chamada com retries/timeout --------
async function chatOnce({ model, messages, tools, temperature, maxTokens, responseFormat }) {
  const cli = getClient();
  const ctrl = AbortSignal.timeout(TIMEOUT_MS);
  return await cli.chat.completions.create({
    model,
    messages,
    tools,
    temperature,
    max_tokens: maxTokens,
    response_format: responseFormat === 'json' ? { type: 'json_object' } : undefined,
    signal: ctrl,
  });
}

// -------- API principal --------
/**
 * chat(messages, opts)
 * @param {Array<{role:'system'|'user'|'assistant'|'tool', content:string}>} messages
 * @param {Object} opts
 *   - stage: 'greet'|'qualify'|'offer'|'close'|'postsale'|...
 *   - tools: { [name]: async (args)=>any }
 *   - responseFormat: 'json' | undefined
 *   - temperature?: number
 *   - maxTokens?: number
 */
export async function chat(messages, opts = {}) {
  const {
    stage,
    tools,
    responseFormat,
    temperature = (Number.isFinite(+settings?.llm?.temperature) ? +settings.llm.temperature
                  : Number.isFinite(+process.env.LLM_TEMPERATURE) ? +process.env.LLM_TEMPERATURE
                  : 0.6),
    maxTokens,
  } = opts;

  // Modelo por etapa coerente com core/llm.js
  let model;
  try {
    model = pickModelForStage(stage);
  } catch {
    model = legacyPick(stage);
  }

  // Heurística simples p/ tokens se não vier definido
  const m = String(model).toLowerCase();
  const defaultMax =
    m.includes('nano') ? (Number.isFinite(+process.env.LLM_MAX_TOKENS_NANO) ? +process.env.LLM_MAX_TOKENS_NANO : 512) :
    m.includes('mini') ? (Number.isFinite(+process.env.LLM_MAX_TOKENS_MINI) ? +process.env.LLM_MAX_TOKENS_MINI : 1024) :
                         (Number.isFinite(+process.env.LLM_MAX_TOKENS_FULL) ? +process.env.LLM_MAX_TOKENS_FULL : 2048);
  const maxToks = Number.isFinite(+maxTokens) ? +maxTokens : defaultMax;

  const toolDefs = toOpenAITools(tools);
  const base = { model, temperature, maxTokens: maxToks, responseFormat };

  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      // 1ª chamada
      let res = await chatOnce({ ...base, messages, tools: toolDefs });
      let choice = res.choices?.[0];

      // Se houve tool_calls, executa e faz 2ª chamada
      if (choice?.message?.tool_calls?.length) {
        const toolMsgs = await runToolCalls(choice.message.tool_calls, tools);
        const followMessages = [
          ...messages,
          choice.message, // assistant com tool_calls
          ...toolMsgs,
        ];
        res = await chatOnce({ ...base, messages: followMessages, tools: toolDefs });
        choice = res.choices?.[0];
      }

      const final = choice?.message;
      return {
        message: final?.content || '',
        raw: res,
        model,
      };
    } catch (e) {
      lastErr = e;
      // backoff exponencial leve
      const delay = Math.min(1000 * 2 ** attempt, 4000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// Export debug opcional
export const EFFECTIVE_MODEL = (stage) => {
  try { return pickModelForStage(stage); } catch { return legacyPick(stage); }
};
