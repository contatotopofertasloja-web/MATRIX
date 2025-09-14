// src/core/settings.js
// Core neutro: carrega settings do bot (YAML), aplica defaults/ENVs e exporta.
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

if (process.env.NODE_ENV !== "production") {
  try { await import("dotenv/config"); } catch {}
}

export const ROOT_DIR = process.cwd();
export const BOT_ID = String(process.env.BOT_ID || "claudia");

function loadBotYaml(botId) {
  const p = path.join(ROOT_DIR, "configs", "bots", botId, "settings.yaml");
  if (!fs.existsSync(p)) {
    throw new Error(`[settings] arquivo não encontrado: ${p}`);
  }
  const raw = fs.readFileSync(p, "utf8");
  return yaml.load(raw) || {};
}

const envBool = (v, d=false) => {
  if (v === undefined || v === null) return d;
  const s = String(v).trim().toLowerCase();
  return ["1","true","yes","y","on"].includes(s);
};
const envNum = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;

function mergeDeep(base, extra) {
  if (Array.isArray(base) && Array.isArray(extra)) return extra; // override arrays
  if (base && typeof base === "object" && extra && typeof extra === "object") {
    const out = { ...base };
    for (const k of Object.keys(extra)) out[k] = mergeDeep(base[k], extra[k]);
    return out;
  }
  return extra === undefined ? base : extra;
}

function defaultsFromEnv() {
  // LLM defaults/flags por ENV (opcional)
  const models = {
    recepcao:     process.env.LLM_MODEL_RECEPCAO,
    qualificacao: process.env.LLM_MODEL_QUALIFICACAO,
    oferta:       process.env.LLM_MODEL_OFERTA,
    objecoes:     process.env.LLM_MODEL_OBJECOES,
    fechamento:   process.env.LLM_MODEL_FECHAMENTO,
    posvenda:     process.env.LLM_MODEL_POSVENDA,
  };

  return {
    flags: {
      useModelsByStage: envBool(process.env.USE_MODELS_BY_STAGE, true),
      fallbackToGlobal: envBool(process.env.FALLBACK_TO_GLOBAL_MODELS, true),
    },
    llm: {
      provider: process.env.LLM_PROVIDER || "openai",
      temperature: Number(process.env.LLM_TEMPERATURE ?? 0.5),
      maxTokens: {
        nano: Number(process.env.LLM_MAX_TOKENS_NANO ?? 512),
        mini: Number(process.env.LLM_MAX_TOKENS_MINI ?? 1024),
        full: Number(process.env.LLM_MAX_TOKENS_FULL ?? 2048),
      },
      timeoutMs: envNum(process.env.LLM_TIMEOUT_MS, 25000),
      retries: envNum(process.env.LLM_RETRIES, 2),
    },
    models_by_stage: Object.fromEntries(
      Object.entries(models).filter(([,v]) => !!v)
    ),
    product: {
      checkout_link: process.env.CHECKOUT_LINK || undefined,
      coupon_code: process.env.COUPON_CODE || undefined,
      price_target: envNum(process.env.PRICE_TARGET, undefined),
    },
  };
}

// Sanitização de respostas fixas (empresa/horário/rendimento/garantia)
function normalizeFixedAnswers(cfg) {
  const s = { ...cfg };

  // Empresa e horário
  s.company_name = s.company_name || "TopOfertas";
  s.business = s.business || {};
  s.business.tz_offset_hours = Number(s.business.tz_offset_hours ?? -3);
  s.business.hours_start = s.business.hours_start || "06:00";
  s.business.hours_end = s.business.hours_end || "21:00";

  // Sweepstake teaser default
  if (!s.sweepstakes) s.sweepstakes = { enabled: false };
  if (s.sweepstakes.enabled) {
    s.sweepstakes.messages = s.sweepstakes.messages || {};
    s.sweepstakes.messages.teaser = s.sweepstakes.messages.teaser || [
      "Todo mês tem sorteio: 1º Escova Alisadora 3 em 1, 2º Progressiva Vegetal e 3º Ativador Capilar. Ao comprar, você já concorre 💝",
    ];
  }

  // Produto: rendimento/duração (ajuste pedido)
  s.product = s.product || {};
  s.product.applications_range = s.product.applications_range || "até 10 aplicações";
  s.product.duration_avg = s.product.duration_avg || "em média 3 meses";

  // Guardrails básicos
  s.guardrails = s.guardrails || {};
  if (s.guardrails.allow_links_only_from_list) {
    s.guardrails.allowed_links = s.guardrails.allowed_links || [
      "https://entrega.logzz.com.br/pay/memmpxgmg/progcreme170",
      "https://entrega.logzz.com.br",
      "https://tpofertas.com/collections/cod-todos",
    ];
  }

  // Pagamentos/parcelamento default
  s.payments = s.payments || {};
  s.payments.installments = s.payments.installments || { enabled: true, max_installments: 12, hint_text: "até 12x" };

  // Flags essenciais
  s.flags = s.flags || {};
  if (!("checkout_mode" in s.flags)) s.flags.checkout_mode = "concierge";

  return s;
}

const fromYaml = loadBotYaml(BOT_ID);
const merged = mergeDeep(fromYaml, defaultsFromEnv());
export const settings = normalizeFixedAnswers(merged);

export default { BOT_ID, settings };
