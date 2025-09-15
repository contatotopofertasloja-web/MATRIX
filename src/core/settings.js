// src/core/settings.js
// Loader unificado de settings com merge ENV → YAML → defaults,
// normalização de estágios, flags e saneamento de produto (preço/link).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..', '..');

function env(name, def) {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? def : v;
}

export const BOT_ID = env('BOT_ID', 'claudia');
const BOT_SETTINGS_PATH = path.join(ROOT, 'configs', 'bots', BOT_ID, 'settings.yaml');

// ----- Normalização de estágios (aliases → chave canônica)
const STAGE_KEY_ALIASES = new Map([
  ['recepção','recepcao'], ['recepcao','recepcao'], ['greet','recepcao'], ['saudacao','recepcao'], ['saudação','recepcao'], ['start','recepcao'], ['hello','recepcao'],
  ['qualificação','qualificacao'], ['qualificacao','qualificacao'], ['qualify','qualificacao'],
  ['oferta','oferta'], ['offer','oferta'], ['apresentacao','oferta'], ['apresentação','oferta'], ['pitch','oferta'],
  ['objeções','objecoes'], ['objecoes','objecoes'], ['objection','objecoes'], ['negociacao','objecoes'], ['negociação','objecoes'], ['objection_handling','objecoes'],
  ['fechamento','fechamento'], ['close','fechamento'], ['checkout','fechamento'], ['closing','fechamento'],
  ['pós-venda','posvenda'], ['posvenda','posvenda'], ['postsale','posvenda'], ['pos_venda','posvenda'], ['pós_venda','posvenda'],
]);

function normalizeStageKey(k) {
  if (!k) return k;
  const base = String(k).trim().toLowerCase();
  return STAGE_KEY_ALIASES.get(base) || base;
}
function normalizeModelsByStage(map) {
  const out = {};
  if (map && typeof map === 'object') {
    for (const [k, v] of Object.entries(map)) {
      out[normalizeStageKey(k)] = String(v || '').trim();
    }
  }
  return out;
}

// ----- Defaults globais de modelos (fallback)
const GLOBAL_MODELS = {
  recepcao:     env('LLM_MODEL_RECEPCAO',     'gpt-5-nano'),
  qualificacao: env('LLM_MODEL_QUALIFICACAO', 'gpt-5-nano'),
  oferta:       env('LLM_MODEL_OFERTA',       'gpt-5-mini'),
  objecoes:     env('LLM_MODEL_OBJECOES',     'gpt-5'),
  fechamento:   env('LLM_MODEL_FECHAMENTO',   'gpt-5-mini'),
  posvenda:     env('LLM_MODEL_POSVENDA',     'gpt-5-nano'),
};

// ----- Flags padrão (podem ser sobrepostas pelo YAML da bot)
const FLAGS = {
  useModelsByStage:      env('USE_MODELS_BY_STAGE', 'true') === 'true',
  fallbackToGlobal:      env('FALLBACK_TO_GLOBAL_MODELS', 'true') === 'true',
  // força o core/base em prompts (útil pra depurar bot-prompts sem removê-los)
  force_core_prompts:    env('PROMPTS_FORCE_CORE', '') === '1',
};

// ----- Áudio/voz (mantém compat com base do projeto)
const AUDIO = {
  asrProvider: env('ASR_PROVIDER', 'openai'),
  asrModel:    env('ASR_MODEL',    'whisper-1'),
  ttsProvider: env('TTS_PROVIDER', 'none'),
  ttsVoice:    env('TTS_VOICE',    'alloy'),
};

// ----- LLM defaults (aplicados se bot não definir no YAML)
const LLM_DEFAULTS = {
  provider:    env('LLM_PROVIDER', 'openai'),
  temperature: Number(env('LLM_TEMPERATURE', '0.5')),
  timeouts: { defaultMs: Number(env('LLM_TIMEOUT_MS', '25000')) },
  maxTokens: {
    nano: Number(env('LLM_MAX_TOKENS_NANO', '512')),
    mini: Number(env('LLM_MAX_TOKENS_MINI', '1024')),
    full: Number(env('LLM_MAX_TOKENS_FULL', '2048')),
  },
  retries: Number(env('LLM_RETRIES', '2')),
};

// ----- Carrega YAML da bot + saneia com ENV (preço/link/cupom)
let fileSettings = {
  bot_id: BOT_ID,
  persona_name: 'Cláudia',
  product: { price_original: 197, price_target: 170, checkout_link: '', coupon_code: '' },
  models_by_stage: {},
  flags: { has_cod: true, send_opening_photo: true },
};

try {
  if (fs.existsSync(BOT_SETTINGS_PATH)) {
    const text = fs.readFileSync(BOT_SETTINGS_PATH, 'utf8');
    const parsed = YAML.parse(text) || {};
    if (parsed.models_by_stage) parsed.models_by_stage = normalizeModelsByStage(parsed.models_by_stage);
    if (parsed.global_models)   parsed.global_models   = normalizeModelsByStage(parsed.global_models);
    fileSettings = { ...fileSettings, ...parsed };
    console.log(`[SETTINGS] Carregado: ${BOT_SETTINGS_PATH}`);
  } else {
    console.warn(`[SETTINGS] Arquivo não encontrado: ${BOT_SETTINGS_PATH}`);
  }
} catch (e) {
  console.warn('[SETTINGS] Falha ao ler YAML:', e?.message || e);
}

// Patch saneador: ENV tem prioridade suave sobre YAML para campos críticos do produto
function asNumber(x, def) {
  if (x == null || x === '') return def;
  const n = Number(String(x).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}
const envProduct = {
  price_original: asNumber(process.env.PRICE_ORIGINAL, fileSettings?.product?.price_original ?? 197),
  price_target:   asNumber(process.env.PRICE_TARGET,   fileSettings?.product?.price_target   ?? 170),
  checkout_link:  process.env.CHECKOUT_LINK?.trim() || fileSettings?.product?.checkout_link || '',
  site_url:       process.env.SITE_URL?.trim()       || fileSettings?.product?.site_url     || '',
  coupon_code:    process.env.COUPON_CODE?.trim()    || fileSettings?.product?.coupon_code  || '',
};
fileSettings.product = { ...(fileSettings.product || {}), ...envProduct };

// ----- Export final (core-neutro)
export const settings = {
  botId: BOT_ID,
  ...fileSettings,
  llm: LLM_DEFAULTS,
  flags: { ...FLAGS, ...(fileSettings.flags || {}) },
  audio: AUDIO,
  global_models: { ...(fileSettings.global_models || {}), ...GLOBAL_MODELS },
};
export default settings;
