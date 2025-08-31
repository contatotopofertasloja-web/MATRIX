// src/core/llm.js
import OpenAI from 'openai';
import { settings } from './settings.js';

const STAGE_KEYS = {
  recepcao:     ['recepcao', 'recepção', 'greet', 'saudacao', 'saudação'],
  qualificacao: ['qualificacao', 'qualificação', 'qualify'],
  oferta:       ['oferta', 'offer', 'apresentacao', 'apresentação'],
  objeções:     ['objeções', 'objecoes', 'objection', 'negociacao', 'negociação'],
  fechamento:   ['fechamento', 'close', 'checkout'],
  posvenda:     ['posvenda', 'pósvenda', 'postsale', 'pos_venda', 'pós_venda'],
};

function resolveStageKey(stage) {
  const t = String(stage || '').toLowerCase();
  for (const canonical in STAGE_KEYS) {
    if (STAGE_KEYS[canonical].some(k => t.includes(k))) return canonical;
  }
  return t || 'recepcao';
}

export function pickModelForStage(stageRaw) {
  const stage = resolveStageKey(stageRaw);
  const fromYaml = settings?.models_by_stage?.[stage];
  if (settings?.flags?.useModelsByStage && fromYaml) return fromYaml;

  const fromEnv = settings?.global_models?.[stage];
  if (settings?.flags?.fallbackToGlobal && fromEnv) return fromEnv;

  return 'GPT-5-nano';
}

let openai = null;
function getOpenAI() {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

export async function callLLM({ stage, system, prompt, temperature }) {
  const model = pickModelForStage(stage);
  const temp  = typeof temperature === 'number' ? temperature : settings?.llm?.temperature ?? 0.5;

  const maxTokens =
    /nano/i.test(model) ? settings.llm.maxTokens.nano :
    /mini/i.test(model) ? settings.llm.maxTokens.mini :
                          settings.llm.maxTokens.full;

  if ((settings.llm.provider || 'openai') !== 'openai') {
    throw new Error(`Provider "${settings.llm.provider}" não implementado neste módulo.`);
  }

  const client = getOpenAI();
  const res = await client.chat.completions.create({
    model,
    temperature: temp,
    max_tokens: maxTokens,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt || '' },
    ],
  });

  const text = res?.choices?.[0]?.message?.content?.trim() || '';
  return { model, text };
}
