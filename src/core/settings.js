// src/core/settings.js — loader neutro de settings por BOT_ID
// - Sem “configs/configs”
// - Suporte a CONFIGS_ROOT (opcional) e .yaml/.yml
// - Normaliza models_by_stage e flags globais

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, "..", "..");

function env(name, dflt) {
  const v = process.env[name];
  return v == null || v === "" ? dflt : v;
}

export const BOT_ID = env("BOT_ID", "claudia");

// Permite customizar a raiz das configs via ENV (ex.: "/app/configs")
const CONFIGS_ROOT = path.resolve(env("CONFIGS_ROOT", path.join(ROOT, "configs")));

// Candidatos para settings do bot
const CANDIDATES = [
  path.join(CONFIGS_ROOT, "bots", BOT_ID, "settings.yaml"),
  path.join(CONFIGS_ROOT, "bots", BOT_ID, "settings.yml"),
];

function readYamlIfExists(p) {
  if (!fs.existsSync(p)) return null;
  try {
    const text = fs.readFileSync(p, "utf8");
    return YAML.parse(text) || {};
  } catch (e) {
    console.warn("[SETTINGS] Falha ao ler YAML:", p, e?.message || e);
    return {};
  }
}

function normalizeStageKey(k) {
  const map = new Map([
    ["recepção","recepcao"], ["recepcao","recepcao"], ["greet","recepcao"], ["saudacao","recepcao"], ["saudação","recepcao"], ["start","recepcao"], ["hello","recepcao"],
    ["qualificação","qualificacao"], ["qualificacao","qualificacao"], ["qualify","qualificacao"],
    ["oferta","oferta"], ["offer","oferta"], ["apresentação","oferta"], ["apresentacao","oferta"], ["pitch","oferta"],
    ["objeções","objecoes"], ["objecoes","objecoes"], ["objection","objecoes"], ["negociação","objecoes"], ["negociacao","objecoes"], ["objection_handling","objecoes"],
    ["fechamento","fechamento"], ["close","fechamento"], ["checkout","fechamento"], ["closing","fechamento"],
    ["pós-venda","posvenda"], ["posvenda","posvenda"], ["postsale","posvenda"], ["pos_venda","posvenda"], ["pós_venda","posvenda"],
  ]);
  const s = String(k || "").trim().toLowerCase();
  return map.get(s) || s;
}
function normalizeModelsByStage(map) {
  const out = {};
  if (map && typeof map === "object") {
    for (const [k, v] of Object.entries(map)) out[normalizeStageKey(k)] = String(v || "").trim();
  }
  return out;
}

// Defaults “razão social” do core (neutro)
const GLOBAL_MODELS = {
  recepcao:     env("LLM_MODEL_RECEPCAO",     "gpt-5-nano"),
  qualificacao: env("LLM_MODEL_QUALIFICACAO", "gpt-5-nano"),
  oferta:       env("LLM_MODEL_OFERTA",       "gpt-5-mini"),
  objecoes:     env("LLM_MODEL_OBJECOES",     "gpt-5"),
  fechamento:   env("LLM_MODEL_FECHAMENTO",   "gpt-5-mini"),
  posvenda:     env("LLM_MODEL_POSVENDA",     "gpt-5-nano"),
};

const FLAGS = {
  useModelsByStage:   env("USE_MODELS_BY_STAGE", "true") === "true",
  fallbackToGlobal:   env("FALLBACK_TO_GLOBAL_MODELS", "true") === "true",
  force_core_prompts: env("PROMPTS_FORCE_CORE", "") === "1",
};

const AUDIO = {
  asrProvider: env("ASR_PROVIDER", "openai"),
  asrModel:    env("ASR_MODEL",    "whisper-1"),
  ttsProvider: env("TTS_PROVIDER", "none"),
  ttsVoice:    env("TTS_VOICE",    "alloy"),
};

const LLM_DEFAULTS = {
  provider:    env("LLM_PROVIDER", "openai"),
  temperature: Number(env("LLM_TEMPERATURE", "0.5")),
  timeouts: { defaultMs: Number(env("LLM_TIMEOUT_MS", "25000")) },
  maxTokens: {
    nano: Number(env("LLM_MAX_TOKENS_NANO", "512")),
    mini: Number(env("LLM_MAX_TOKENS_MINI", "1024")),
    full: Number(env("LLM_MAX_TOKENS_FULL", "2048")),
  },
  retries: Number(env("LLM_RETRIES", "2")),
};

// Carrega primeiro caminho que existir
let loaded = null;
let usedPath = null;
for (const p of CANDIDATES) {
  const obj = readYamlIfExists(p);
  if (obj) { loaded = obj; usedPath = p; break; }
}

if (loaded) {
  if (loaded.models_by_stage) loaded.models_by_stage = normalizeModelsByStage(loaded.models_by_stage);
  console.log(`[SETTINGS] Carregado: ${usedPath}`);
} else {
  console.warn(`[SETTINGS] Arquivo não encontrado. Esperado em uma destas rotas:`);
  for (const p of CANDIDATES) console.warn(" -", p);
  loaded = {};
}

// Defaults mínimos
const fileDefaults = {
  bot_id: BOT_ID,
  persona_name: "Cláudia",
  product: { price_original: 197, price_target: 170, checkout_link: "", coupon_code: "" },
  models_by_stage: {},
  flags: { has_cod: true, send_opening_photo: true },
};

export const settings = {
  botId: BOT_ID,
  ...fileDefaults,
  ...loaded,
  llm: LLM_DEFAULTS,
  flags: { ...fileDefaults.flags, ...(loaded.flags || {}), ...FLAGS },
  audio: AUDIO,
  global_models: GLOBAL_MODELS,
};

export default settings;
