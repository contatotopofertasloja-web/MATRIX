// [MATRIX_STAMP:settings v2.2] src/core/settings.js — Loader neutro (Matrix IA 2.0)
// - Lê CONFIGS_ROOT/bots/<BOT_ID>/settings.yaml|yml
// - Se BOT_ID ≠ "default" e o arquivo não existir, NÃO emite warn (apenas debug)
// - Normaliza models_by_stage (recepção→recepcao, qualify→qualificacao, etc.)
// - Aplica defaults e ENV sem “cheiro” de bot
// - Mantém estrutura compatível com o core e flows

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, "..", "..");

// ---------- Utils ----------
const env = (k, d) => {
  const v = process.env[k];
  return v === undefined || v === "" ? d : v;
};
const envB = (k, d=false) => {
  const v = env(k, null);
  if (v == null) return d;
  const s = String(v).trim().toLowerCase();
  return ["1","true","yes","y","on"].includes(s);
};
const envN = (k, d) => {
  const v = Number(env(k, NaN));
  return Number.isFinite(v) ? v : d;
};
const LOG_LEVEL = String(env("SETTINGS_LOG_LEVEL", "info")).toLowerCase();
const logDbg = (...a) => { if (["debug","trace"].includes(LOG_LEVEL)) console.log("[SETTINGS:debug]", ...a); };
const logInf = (...a) => console.log("[SETTINGS]", ...a);
const logWrn = (...a) => console.warn("[SETTINGS]", ...a);

// ---------- Localização dos arquivos ----------
export const BOT_ID = env("BOT_ID", "default");
const CONFIGS_ROOT  = path.resolve(env("CONFIGS_ROOT", path.join(ROOT, "configs")));

const CANDIDATES = [
  path.join(CONFIGS_ROOT, "bots", BOT_ID, "settings.yaml"),
  path.join(CONFIGS_ROOT, "bots", BOT_ID, "settings.yml"),
];

function readYamlIfExists(p) {
  if (!fs.existsSync(p)) return null;
  try {
    const txt = fs.readFileSync(p, "utf8");
    return YAML.parse(txt) || {};
  } catch (e) {
    logWrn("Falha ao ler YAML:", p, e?.message || e);
    return {};
  }
}

// ---------- Normalizações ----------
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
function normalizeModelsByStage(m) {
  const out = {};
  if (m && typeof m === "object") {
    for (const [k, v] of Object.entries(m)) out[normalizeStageKey(k)] = String(v || "").trim();
  }
  return out;
}

// ---------- Defaults globais ----------
const GLOBAL_MODELS = {
  recepcao:     env("LLM_MODEL_RECEPCAO",     "gpt-5-nano"),
  qualificacao: env("LLM_MODEL_QUALIFICACAO", "gpt-5-nano"),
  oferta:       env("LLM_MODEL_OFERTA",       "gpt-5-mini"),
  objecoes:     env("LLM_MODEL_OBJECOES",     "gpt-5"),
  fechamento:   env("LLM_MODEL_FECHAMENTO",   "gpt-5-mini"),
  posvenda:     env("LLM_MODEL_POSVENDA",     "gpt-5-nano"),
};

const LLM_DEFAULTS = {
  provider:    env("LLM_PROVIDER", "openai"),
  temperature: envN("LLM_TEMPERATURE", 0.5),
  timeouts:    { defaultMs: envN("LLM_TIMEOUT_MS", 25000) },
  maxTokens:   {
    nano: envN("LLM_MAX_TOKENS_NANO", 512),
    mini: envN("LLM_MAX_TOKENS_MINI", 1024),
    full: envN("LLM_MAX_TOKENS_FULL", 2048),
  },
  retries:     envN("LLM_RETRIES", 2),
};

const AUDIO = {
  asrProvider: env("ASR_PROVIDER", "openai"),
  asrModel:    env("ASR_MODEL",    "whisper-1"),
  ttsProvider: env("TTS_PROVIDER", "none"),
  ttsVoice:    env("TTS_VOICE",    "alloy"),
  language:    env("ASR_LANG",     "pt"),
};

const ENV_FLAGS = {
  useModelsByStage:   envB("USE_MODELS_BY_STAGE", true),
  fallbackToGlobal:   envB("FALLBACK_TO_GLOBAL_MODELS", true),
  force_core_prompts: env("PROMPTS_FORCE_CORE", "") === "1",
  flow_only:          envB("FLOW_ONLY", false),
  send_opening_photo: envB("SEND_OPENING_PHOTO", true),
  reply_dedupe_ms:    envN("REPLY_DEDUPE_MS", Number(env("REPLY_DEDUPE_MS", "0"))),
};

// ---------- Leitura do arquivo ----------
let loaded = null; let usedPath = null;
for (const p of CANDIDATES) {
  const obj = readYamlIfExists(p);
  if (obj) { loaded = obj; usedPath = p; break; }
}

// Logs: se BOT_ID !== default e não achou, fica só no debug
if (loaded) {
  if (loaded.models_by_stage) loaded.models_by_stage = normalizeModelsByStage(loaded.models_by_stage);
  logInf("Carregado:", usedPath);
} else {
  if (BOT_ID === "default") {
    logWrn("Arquivo não encontrado em:", ...CANDIDATES);
  } else {
    logDbg(`YAML não encontrado para BOT_ID='${BOT_ID}' (caminhos testados):`, CANDIDATES);
  }
  loaded = {};
}

// ---------- Defaults de arquivo (neutros) ----------
const FILE_DEFAULTS = {
  bot_id: BOT_ID,
  persona_name: "Atendente", // core neutro
  product: {
    title: "",
    price_original: 0,
    price_target: 0,
    checkout_link: "",
    coupon_code: "",
    image_url: "",
  },
  models_by_stage: {},
  flags: {
    has_cod: true,
    send_opening_photo: true,
    flow_only: false,
  },
  guardrails: {
    allowed_links: [], // pode conter templates {{product.checkout_link}}
  },
  messages: {
    opening: [],
    opening_named: [],
  },
};

// ---------- Merge + saída ----------
function deepMerge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (a && typeof a === "object" && b && typeof b === "object") {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = deepMerge(a[k], v);
    return out;
  }
  return b === undefined ? a : b;
}

const merged = deepMerge(FILE_DEFAULTS, loaded);

// flags finais: arquivo → ENV (ENV sobrepõe onde definido)
const finalFlags = {
  ...merged.flags,
  ...ENV_FLAGS,
};

// objeto final exportado
export const settings = {
  botId: BOT_ID,
  ...merged,
  flags: finalFlags,
  llm: LLM_DEFAULTS,
  audio: AUDIO,
  global_models: GLOBAL_MODELS,
};

// Pequena higiene: garantir shape básico mesmo sem YAML
if (!settings.product) settings.product = { price_original:0, price_target:0, checkout_link:"", coupon_code:"", title:"", image_url:"" };
if (!settings.guardrails) settings.guardrails = { allowed_links: [] };
if (!Array.isArray(settings.guardrails.allowed_links)) settings.guardrails.allowed_links = [];

export default settings;
