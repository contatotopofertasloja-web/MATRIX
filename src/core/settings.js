// src/core/settings.js — COMPLETÃO
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
const asBool = (v, d = false) =>
  v == null ? d : ['1', 'true', 'yes', 'y', 'on'].includes(String(v).trim().toLowerCase());

export const BOT_ID = env('BOT_ID', 'claudia');
const BOT_SETTINGS_PATH = path.join(ROOT, 'configs', 'bots', BOT_ID, 'settings.yaml');

const STAGE_KEY_ALIASES = new Map([
  ['recepção', 'recepcao'], ['recepcao', 'recepcao'],
  ['qualificação', 'qualificacao'], ['qualificacao', 'qualificacao'],
  ['oferta', 'oferta'],
  ['objeções', 'objecoes'], ['objecoes', 'objecoes'],
  ['fechamento', 'fechamento'],
  ['pós-venda', 'posvenda'], ['posvenda', 'posvenda'], ['postsale', 'posvenda'],
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

const GLOBAL_MODELS = {
  recepcao:     env('LLM_MODEL_RECEPCAO',     'gpt-5-nano'),
  qualificacao: env('LLM_MODEL_QUALIFICACAO', 'gpt-5-nano'),
  oferta:       env('LLM_MODEL_OFERTA',       'gpt-5-mini'),
  objecoes:     env('LLM_MODEL_OBJECOES',     'gpt-5'),
  fechamento:   env('LLM_MODEL_FECHAMENTO',   'gpt-5-mini'),
  posvenda:     env('LLM_MODEL_POSVENDA',     'gpt-5-nano'),
};

const FLAGS = {
  useModelsByStage:    asBool(env('USE_MODELS_BY_STAGE', 'true'), true),
  fallbackToGlobal:    asBool(env('FALLBACK_TO_GLOBAL_MODELS', 'true'), true),
};

const AUDIO = {
  asrProvider: env('ASR_PROVIDER', 'openai'),
  asrModel:    env('ASR_MODEL',    'whisper-1'),
  ttsProvider: env('TTS_PROVIDER', 'openai'),
  ttsVoice:    env('TTS_VOICE',    'alloy'),
  language:    env('ASR_LANG',     'pt'),
};

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

let fileSettings = {
  bot_id: BOT_ID,
  persona_name: 'Cláudia',
  language: 'pt-BR',
  business: { tz_offset_hours: -3, hours_start: '06:00', hours_end: '21:00' },
  product: { price_original: 197, price_target: 170, checkout_link: '', coupon_code: '' },
  models_by_stage: {},
  flags: { has_cod: true, send_opening_photo: true },
  guardrails: {},
  messages: {},
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

// ENV overrides
fileSettings.product = fileSettings.product || {};
{
  const envCheckout = env('CHECKOUT_LINK', '').trim();
  const envCoupon   = env('COUPON_CODE', '').trim();
  const envPriceT   = env('PRICE_TARGET', '').trim();
  if (envCheckout) fileSettings.product.checkout_link = envCheckout;
  if (envCoupon)   fileSettings.product.coupon_code   = envCoupon;
  if (envPriceT !== '') {
    const n = Number(envPriceT);
    if (!Number.isNaN(n)) fileSettings.product.price_target = n;
  }
}

// Audio flags via ENV
{
  const audioOutEnv = env('ALLOW_AUDIO_OUT', '');
  const audioInEnv  = env('ALLOW_AUDIO_IN',  '');
  fileSettings.flags = fileSettings.flags || {};
  if (audioOutEnv !== '') fileSettings.flags.allow_audio_out = asBool(audioOutEnv, true);
  if (audioInEnv  !== '') fileSettings.flags.allow_audio_in  = asBool(audioInEnv,  true);
}

// Guardrails → garantir que o checkout esteja na allowlist
{
  const g = fileSettings.guardrails || {};
  if (g.allow_links_only_from_list) {
    const allow = new Set(Array.isArray(g.allowed_links) ? g.allowed_links : []);
    if (fileSettings.product.checkout_link) allow.add(fileSettings.product.checkout_link);
    if (fileSettings?.sweepstakes?.page_url) allow.add(fileSettings.sweepstakes.page_url);
    fileSettings.guardrails = { ...g, allowed_links: Array.from(allow) };
  }
}

export const settings = {
  botId: BOT_ID,
  ...fileSettings,
  llm: LLM_DEFAULTS,
  flags: { ...(fileSettings.flags || {}), ...FLAGS },
  audio: AUDIO,
  global_models: { ...GLOBAL_MODELS, ...(fileSettings.global_models || {}) },
};

export default settings;
