// src/core/settings.js — loader com fallback YAML e override por ENV
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const ROOT = process.cwd();
export const BOT_ID = process.env.BOT_ID || 'claudia';

function readYamlSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const txt = fs.readFileSync(filePath, 'utf8');
    return YAML.parse(txt) || {};
  } catch (e) {
    console.error('[settings] erro lendo', filePath, e?.message || e);
    return {};
  }
}

// ————————— Base: settings.yaml
const basePath = path.join(ROOT, 'configs', 'bots', BOT_ID, 'settings.yaml');
let fileSettings = readYamlSafe(basePath);

// ————————— Normalização de nomes de modelo
function normalizeModelName(name) {
  if (!name) return '';
  const s = String(name).trim().toLowerCase();
  // aceita várias grafias
  if (/nano/.test(s)) return 'gpt-5-nano';
  if (/mini/.test(s)) return 'gpt-5-mini';
  if (/full|pro|max|gpt-5$/.test(s)) return 'gpt-5-full';
  // fallback (não quebra)
  return s;
}

// ————————— Map de ENVs → stages
const envModelMap = {
  LLM_MODEL_RECEPCAO:  'greet',
  LLM_MODEL_QUALIFICACAO: 'qualify',
  LLM_MODEL_OFERTA:    'offer',
  LLM_MODEL_OBJECOES:  'objection',
  LLM_MODEL_FECHAMENTO:'close',
  LLM_MODEL_POSVENDA:  'post_sale',
  // extras (caso queira no futuro)
  LLM_MODEL_ENTREGA:   'delivery',
  LLM_MODEL_PAGAMENTO: 'payment',
  LLM_MODEL_RECURSOS:  'features',
};

// ————————— Overrides de produto por ENV (opcionais)
function buildEnvProductOverrides() {
  const p = {};
  if (process.env.CHECKOUT_LINK) p.checkout_link = process.env.CHECKOUT_LINK;
  if (process.env.PRICE_TARGET)  p.price_target  = Number(process.env.PRICE_TARGET);
  if (process.env.COUPON_CODE !== undefined) {
    p.coupon_code = process.env.COUPON_CODE; // pode ser string vazia
  }
  // mantém regra “cupom só após pagamento” — se já estiver no YAML, não mexe
  return Object.keys(p).length ? { product: p } : {};
}

// ————————— Overrides de modelos por ENV (opcionais)
function buildEnvModelsOverrides() {
  const out = {};
  for (const [envKey, stage] of Object.entries(envModelMap)) {
    const val = process.env[envKey];
    if (!val) continue;
    out[stage] = normalizeModelName(val);
  }
  return Object.keys(out).length ? { models_by_stage: out } : {};
}

// ————————— Deep merge raso (suficiente aqui)
function deepMerge(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(a?.[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ————————— Aplica overrides (ENV > YAML)
const envProduct = buildEnvProductOverrides();
const envModels  = buildEnvModelsOverrides();
const merged = deepMerge(fileSettings, deepMerge(envProduct, envModels));

// ————————— Defaults úteis (caso falte algo no YAML)
if (!merged.product) merged.product = {};
if (merged.product.price_target == null) merged.product.price_target = 170;
if (!merged.product.checkout_link && process.env.CHECKOUT_LINK) {
  merged.product.checkout_link = process.env.CHECKOUT_LINK;
}
if (!merged.models_by_stage) {
  merged.models_by_stage = {
    greet: 'gpt-5-nano',
    qualify: 'gpt-5-nano',
    offer: 'gpt-5-mini',
    objection: 'gpt-5-full',
    close: 'gpt-5-mini',
    post_sale: 'gpt-5-nano',
    delivery: 'gpt-5-nano',
    payment: 'gpt-5-nano',
    features: 'gpt-5-nano',
  };
}

// ————————— Export final
export const settings = merged;

// logzinho amigável (curto)
const logProbe = {
  price_target: settings.product?.price_target,
  checkout_link: settings.product?.checkout_link ? 'set' : 'unset',
  coupon_code: settings.product?.coupon_code ? 'set' : 'unset',
  greet_model: settings.models_by_stage?.greet,
  offer_model: settings.models_by_stage?.offer,
  objection_model: settings.models_by_stage?.objection,
};
console.log('[settings] loaded', logProbe);
