// src/model.js
import { OpenAI } from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ---- helpers de seleção de modelo por etapa ----
function parseModelsByStage() {
  try {
    const raw = process.env.MODELS_BY_STAGE_JSON || '{}';
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  } catch (e) {
    console.warn('[MODEL] MODELS_BY_STAGE_JSON inválido:', e?.message || e);
  }
  return {};
}

export function getModelForStage(stage) {
  const map = parseModelsByStage();
  const key = String(stage || '').trim();
  if (key && map[key]) return map[key];
  return process.env.MODEL_NAME || 'gpt-4o';
}

// Exponho só pra debug opcional
export const EFFECTIVE_MODEL = (stage) => getModelForStage(stage);

// ---- transformação de "tools JS" em tools do OpenAI ----
function toOpenAITools(tools) {
  if (!tools) return undefined;
  return Object.keys(tools).map((name) => ({
    type: 'function',
    function: {
      name,
      description: `Ferramenta ${name}`,
      // Aceita qualquer payload; se quiser, tipa depois etapa 2.0
      parameters: { type: 'object', properties: {}, additionalProperties: true }
    }
  }));
}

// ---- executa ferramentas solicitadas pelo modelo ----
async function runToolCalls(toolCalls = [], tools = {}) {
  const toolMessages = [];
  for (const call of toolCalls) {
    try {
      const fn = tools?.[call.function?.name];
      const args = JSON.parse(call.function?.arguments || '{}');
      if (!fn) {
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: `tool "${call.function?.name}" não implementada` })
        });
        continue;
      }
      const result = await fn(args);
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result ?? { ok: true })
      });
    } catch (e) {
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({ ok: false, error: e?.message || String(e) })
      });
    }
  }
  return toolMessages;
}

/**
 * chat(messages, opts)
 *  - stage: 'greet' | 'qualify' | 'offer' | 'close' | 'post_sale' | ...
 *  - tools: { [name]: async (args)=>any }
 *  - responseFormat: 'json' | undefined
 *  - temperature, maxTokens
 */
export async function chat(messages, opts = {}) {
  const {
    stage,
    tools,
    responseFormat,
    temperature = 0.6,
    maxTokens = 350
  } = opts;

  const model = getModelForStage(stage);
  const toolDefs = toOpenAITools(tools);

  // 1ª chamada
  let res = await client.chat.completions.create({
    model,
    messages,
    tools: toolDefs,
    temperature,
    max_tokens: maxTokens,
    response_format: responseFormat === 'json' ? { type: 'json_object' } : undefined
  });

  const choice = res.choices?.[0];
  if (choice?.message?.tool_calls?.length) {
    // Executa tools e faz 2ª chamada com os resultados
    const toolMsgs = await runToolCalls(choice.message.tool_calls, tools);
    const followMessages = [
      ...messages,
      choice.message, // assistant com tool_calls
      ...toolMsgs
    ];

    res = await client.chat.completions.create({
      model,
      messages: followMessages,
      temperature,
      max_tokens: maxTokens,
      response_format: responseFormat === 'json' ? { type: 'json_object' } : undefined
    });
  }

  const final = res.choices?.[0]?.message;
  return {
    message: final?.content || '',
    raw: res
  };
}
