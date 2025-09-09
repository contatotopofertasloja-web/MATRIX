// src/core/llm.js
import OpenAI from "openai";
import { settings } from "./settings.js";

// -----------------------------
// Stage aliases (pt/en) → chave canônica
// -----------------------------
const STAGE_KEYS = {
  recepcao:     ["recepcao", "recepção", "greet", "saudacao", "saudação", "start", "hello"],
  qualificacao: ["qualificacao", "qualificação", "qualify"],
  oferta:       ["oferta", "offer", "apresentacao", "apresentação", "pitch"],
  // tolera ambos: "objeções" com acento e "objecoes" sem acento
  objecoes:     ["objeções", "objecoes", "objection", "negociacao", "negociação", "objection_handling"],
  fechamento:   ["fechamento", "close", "checkout", "closing"],
  posvenda:     ["posvenda", "pósvenda", "postsale", "pos_venda", "pós_venda"],
};

function resolveStageKey(stage) {
  const t = String(stage || "").toLowerCase().trim();
  for (const canonical in STAGE_KEYS) {
    if (STAGE_KEYS[canonical].some(k => t.includes(k))) return canonical;
  }
  // fallback seguro sempre para chave conhecida
  return "recepcao";
}

// -----------------------------
// ENV defaults e mapas
// -----------------------------
const ENV_DEFAULTS = {
  provider:    settings?.llm?.provider || process.env.LLM_PROVIDER || "openai",
  temperature: Number.isFinite(+settings?.llm?.temperature) ? +settings.llm.temperature
              : Number.isFinite(+process.env.LLM_TEMPERATURE) ? +process.env.LLM_TEMPERATURE
              : 0.5,
  retries:     Number.isFinite(+process.env.LLM_RETRIES) ? +process.env.LLM_RETRIES : 2,
  maxTokens: {
    nano: Number.isFinite(+settings?.llm?.maxTokens?.nano) ? +settings.llm.maxTokens.nano
        : Number.isFinite(+process.env.LLM_MAX_TOKENS_NANO) ? +process.env.LLM_MAX_TOKENS_NANO
        : 512,
    mini: Number.isFinite(+settings?.llm?.maxTokens?.mini) ? +settings.llm.maxTokens.mini
        : Number.isFinite(+process.env.LLM_MAX_TOKENS_MINI) ? +process.env.LLM_MAX_TOKENS_MINI
        : 1024,
    full: Number.isFinite(+settings?.llm?.maxTokens?.full) ? +settings.llm.maxTokens.full
        : Number.isFinite(+process.env.LLM_MAX_TOKENS_FULL) ? +process.env.LLM_MAX_TOKENS_FULL
        : 2048,
  },
};

// Suporte a ENV `LLM_MODEL_*` como fallback global
const ENV_STAGE_VARS = {
  recepcao:     "LLM_MODEL_RECEPCAO",
  qualificacao: "LLM_MODEL_QUALIFICACAO",
  oferta:       "LLM_MODEL_OFERTA",
  objecoes:     "LLM_MODEL_OBJECOES",
  fechamento:   "LLM_MODEL_FECHAMENTO",
  posvenda:     "LLM_MODEL_POSVENDA",
};

// -----------------------------
// Tradução automática de modelos "gpt-5-*" → compat hoje
// -----------------------------
function translateModel(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return n;

  // aliases comuns
  if (n === "gpt-5" || n === "gpt-5-full" || n === "gpt-5-pro") return "gpt-4o";
  if (n === "gpt-5-mini")  return "gpt-4o-mini";
  if (n === "gpt-5-nano")  return "gpt-4o-mini";

  // já compatível? mantém
  return name;
}

// -----------------------------
// Seleção de modelo por etapa
// -----------------------------
export function pickModelForStage(stageRaw) {
  const stage = resolveStageKey(stageRaw);

  // 1) YAML específico por bot
  const fromYaml =
    settings?.models_by_stage?.[stage] ??
    (stage === "objecoes" ? settings?.models_by_stage?.["objeções"] : undefined);
  if (settings?.flags?.useModelsByStage && fromYaml) return fromYaml;

  // 2) ENV global (Railway) — se houver
  const envKey = ENV_STAGE_VARS[stage];
  const fromEnv = envKey ? process.env[envKey] : undefined;
  if (settings?.flags?.fallbackToGlobal && fromEnv) return fromEnv;

  // 3) YAML global_models como fallback
  const fromGlobalYaml =
    settings?.global_models?.[stage] ??
    (stage === "objecoes" ? settings?.global_models?.["objeções"] : undefined);
  if (settings?.flags?.fallbackToGlobal && fromGlobalYaml) return fromGlobalYaml;

  // 4) fallback final
  return "GPT-5-nano";
}

// Heurística de max_tokens por “tamanho” do modelo
function defaultMaxTokensForModel(modelName = "") {
  const m = String(modelName).toLowerCase();
  if (m.includes("nano")) return ENV_DEFAULTS.maxTokens.nano;
  if (m.includes("mini")) return ENV_DEFAULTS.maxTokens.mini;
  return ENV_DEFAULTS.maxTokens.full;
}

// -----------------------------
// Cliente OpenAI (lazy)
// -----------------------------
let openai = null;
function getOpenAI() {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

// -----------------------------
// callLLM com retries leves
// -----------------------------
export async function callLLM({ stage, system, prompt, temperature, maxTokens, model } = {}) {
  // seleciona modelo (pode vir "gpt-5-*")
  const rawModel = model || pickModelForStage(stage);
  // traduz automaticamente para algo suportado hoje
  const chosenModel = translateModel(rawModel);

  const temp = typeof temperature === "number" ? temperature : ENV_DEFAULTS.temperature;
  const mt   = Number.isFinite(+maxTokens) ? +maxTokens : defaultMaxTokensForModel(chosenModel);

  if ((ENV_DEFAULTS.provider || "openai") !== "openai") {
    throw new Error(`Provider "${ENV_DEFAULTS.provider}" não suportado neste módulo.`);
  }

  const client = getOpenAI();
  let lastErr;
  for (let attempt = 0; attempt <= ENV_DEFAULTS.retries; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model: chosenModel,
        temperature: temp,
        max_tokens: mt,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt || "" },
        ],
      });
      const text = res?.choices?.[0]?.message?.content?.trim() || "";
      return { model: chosenModel, text };
    } catch (e) {
      lastErr = e;
      const backoff = Math.min(1000 * (2 ** attempt), 4000);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
