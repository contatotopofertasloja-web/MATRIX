// src/core/llm.js
// ----------------------------------------------------------------------------
// Compat com seu settings atual + robustez:
//  - resolveStageKey (PT/EN) incluindo entrega/pagamento/features
//  - normaliza nomes de modelo (case-insensitive, aliases) e fallback seguro
//  - retries com backoff; fallback automático em 404 model_not_found
//  - Chat Completions por padrão; Responses API opcional (LLM_USE_RESPONSES=true)
// ----------------------------------------------------------------------------

import OpenAI from "openai";
import { settings } from "./settings.js";

// -----------------------------
// Stage aliases (pt/en) → chave canônica
// -----------------------------
const STAGE_KEYS = {
  recepcao:     ["recepcao", "recepção", "greet", "saudacao", "saudação", "start", "hello"],
  qualificacao: ["qualificacao", "qualificação", "qualify"],
  oferta:       ["oferta", "offer", "apresentacao", "apresentação", "pitch"],
  objecoes:     ["objeções", "objecoes", "objection", "negociacao", "negociação", "objection_handling"],
  fechamento:   ["fechamento", "close", "checkout", "closing"],
  posvenda:     ["posvenda", "pósvenda", "postsale", "pos_venda", "pós_venda"],
  entrega:      ["entrega", "delivery"],
  pagamento:    ["pagamento", "payment"],
  features:     ["features", "como usar", "como_usar", "howto", "how_to_use", "usage"],
};

function resolveStageKey(stage) {
  const t = String(stage || "").toLowerCase().trim();
  for (const canonical in STAGE_KEYS) {
    if (STAGE_KEYS[canonical].some(k => t.includes(k))) return canonical;
  }
  return "recepcao";
}

// -----------------------------
// ENV defaults e controles
// -----------------------------
const ENV_DEFAULTS = {
  provider:    settings?.llm?.provider || process.env.LLM_PROVIDER || "openai",
  temperature: Number.isFinite(+settings?.llm?.temperature) ? +settings.llm.temperature
            : Number.isFinite(+process.env.LLM_TEMPERATURE) ? +process.env.LLM_TEMPERATURE
            : 0.5,
  retries:     Number.isFinite(+process.env.LLM_RETRIES) ? +process.env.LLM_RETRIES : 2,
  useResponsesApi: String(process.env.LLM_USE_RESPONSES || "").toLowerCase() === "true",
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

// ENVs por etapa (fallback global opcional)
const ENV_STAGE_VARS = {
  recepcao:     "LLM_MODEL_RECEPCAO",
  qualificacao: "LLM_MODEL_QUALIFICACAO",
  oferta:       "LLM_MODEL_OFERTA",
  objecoes:     "LLM_MODEL_OBJECOES",
  fechamento:   "LLM_MODEL_FECHAMENTO",
  posvenda:     "LLM_MODEL_POSVENDA",
  entrega:      "LLM_MODEL_ENTREGA",
  pagamento:    "LLM_MODEL_PAGAMENTO",
  features:     "LLM_MODEL_FEATURES",
};

// -----------------------------
// Normalização/aliases/fallback
// -----------------------------
// Aceitamos 5.x, 4.1 e 4o (para compat), com subvariantes mini/nano
const VALID_PREFIX = /^(gpt-5(-(mini|nano))?|gpt-4\.1(-(mini|nano))?|gpt-4o(-(mini))?)$/i;

// aliases dos nomes que já vi no seu settings
const MODEL_ALIASES = {
  "gpt-5-full": "gpt-5",       // "full" → id real
  "gpt5-full":  "gpt-5",
  "gpt-5 mini": "gpt-5-mini",
  "gpt-5 nano": "gpt-5-nano",
  "gpt5-mini":  "gpt-5-mini",
  "gpt5-nano":  "gpt-5-nano",
  "gpt-4o-mini":"gpt-5-nano",  // seu projeto migrou p/ 5.x — melhora custo/perf
  "gpt4o-mini": "gpt-5-nano",
  "gpt4o":      "gpt-4.1",
  "gpt-41":     "gpt-4.1",
  "gpt41":      "gpt-4.1",
};

const DEFAULT_MODEL = (process.env.LLM_MODEL || "gpt-5-mini").toLowerCase();

function sanitizeModelName(name) {
  if (!name) return DEFAULT_MODEL;
  let m = String(name).trim().toLowerCase().replace(/\s+/g, " ");
  if (MODEL_ALIASES[m]) m = MODEL_ALIASES[m];
  m = m.replace(/\s/g, "-");
  return VALID_PREFIX.test(m) ? m : DEFAULT_MODEL;
}

function defaultMaxTokensForModel(modelName = "") {
  const m = String(modelName).toLowerCase();
  if (m.includes("nano")) return ENV_DEFAULTS.maxTokens.nano;
  if (m.includes("mini")) return ENV_DEFAULTS.maxTokens.mini;
  return ENV_DEFAULTS.maxTokens.full;
}

// -----------------------------
// Escolha do modelo por etapa
// -----------------------------
export function pickModelForStage(stageRaw) {
  const stage = resolveStageKey(stageRaw);

  const fromYaml =
    settings?.models_by_stage?.[stage] ??
    (stage === "objecoes" ? settings?.models_by_stage?.["objeções"] : undefined);
  if (settings?.flags?.useModelsByStage && fromYaml) return sanitizeModelName(fromYaml);

  const envKey = ENV_STAGE_VARS[stage];
  const fromEnv = envKey ? process.env[envKey] : undefined;
  if (settings?.flags?.fallbackToGlobal && fromEnv) return sanitizeModelName(fromEnv);

  const fromGlobalYaml =
    settings?.global_models?.[stage] ??
    (stage === "objecoes" ? settings?.global_models?.["objeções"] : undefined);
  if (settings?.flags?.fallbackToGlobal && fromGlobalYaml) return sanitizeModelName(fromGlobalYaml);

  return sanitizeModelName(DEFAULT_MODEL);
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
// Chamada com retries + fallback404
// -----------------------------
export async function callLLM({ stage, system, prompt, temperature, maxTokens, model, tools } = {}) {
  if ((ENV_DEFAULTS.provider || "openai") !== "openai") {
    throw new Error(`Provider "${ENV_DEFAULTS.provider}" não suportado neste módulo.`);
  }

  let chosenModel = sanitizeModelName(model || pickModelForStage(stage));
  const temp = typeof temperature === "number" ? temperature : ENV_DEFAULTS.temperature;
  const mt   = Number.isFinite(+maxTokens) ? +maxTokens : defaultMaxTokensForModel(chosenModel);

  const client = getOpenAI();
  let lastErr;

  async function doCall(modelName) {
    if (ENV_DEFAULTS.useResponsesApi) {
      const res = await client.responses.create({
        model: modelName,
        input: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt || "" }
        ],
        temperature: temp,
        max_output_tokens: mt,
        tools,
      });
      return res?.output_text ??
             res?.choices?.[0]?.message?.content?.trim() ?? "";
    } else {
      const res = await client.chat.completions.create({
        model: modelName,
        temperature: temp,
        max_tokens: mt,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt || "" },
        ],
        tools,
      });
      return res?.choices?.[0]?.message?.content?.trim() || "";
    }
  }

  const MAX_ATTEMPTS = Math.max(1, ENV_DEFAULTS.retries + 1);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const text = await doCall(chosenModel);
      return { model: chosenModel, text };
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || "").toLowerCase();
      const status = (e?.status || e?.response?.status || "");
      const is404 = status === 404 || (msg.includes("model") && msg.includes("not") && msg.includes("found"));

      if (is404) {
        const fallback = sanitizeModelName(DEFAULT_MODEL);
        if (fallback !== chosenModel) { chosenModel = fallback; continue; }
      }

      const maybeRetry = [429, 500, 502, 503, 504].includes(+status);
      if (maybeRetry && attempt < MAX_ATTEMPTS - 1) {
        const backoff = Math.min(1000 * (2 ** attempt), 4000);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}
