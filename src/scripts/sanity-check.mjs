// scripts/sanity-check.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Caminho do settings.yaml da Cláudia
const SETTINGS_PATH = path.resolve(
  __dirname,
  "../configs/bots/claudia/settings.yaml"
);

function fail(msg) {
  console.error("✖", msg);
  process.exitCode = 1;
}
function ok(msg) {
  console.log("✔", msg);
}
function ensure(cond, msg) {
  if (!cond) fail(msg);
  else ok(msg);
}
function isNonEmptyString(s) {
  return typeof s === "string" && s.trim().length > 0;
}

function loadYaml(p) {
  const raw = fs.readFileSync(p, "utf8");
  return yaml.parse(raw);
}

(function main() {
  console.log("== Sanity Check :: settings.yaml ==");

  ensure(fs.existsSync(SETTINGS_PATH), `Arquivo encontrado: ${SETTINGS_PATH}`);
  const settings = loadYaml(SETTINGS_PATH);

  // Bot info
  ensure(isNonEmptyString(settings?.bot_id), "bot_id definido");
  ensure(isNonEmptyString(settings?.persona_name), "persona_name definido");
  ensure(isNonEmptyString(settings?.language), "language definido");

  // Produto
  ensure(isNonEmptyString(settings?.product?.name), "product.name definido");
  ensure(Number.isFinite(+settings?.product?.price_original), "price_original numérico");
  ensure(Number.isFinite(+settings?.product?.price_target), "price_target numérico");

  // Links principais
  ensure(isNonEmptyString(settings?.product?.checkout_link), "checkout_link definido");
  ensure(isNonEmptyString(settings?.product?.site_url), "site_url definido");

  // Guardrails
  const min = Number(settings?.guardrails?.price_min);
  const max = Number(settings?.guardrails?.price_max);
  const target = Number(settings?.product?.price_target);
  ensure(Number.isFinite(min) && Number.isFinite(max) && min < max, "price_min < price_max");
  ensure(target >= min && target <= max, "price_target dentro do range");

  // Allowed links
  const allowed = settings?.guardrails?.allowed_links || [];
  ensure(Array.isArray(allowed) && allowed.length > 0, "allowed_links não vazio");
  ["{{checkout_link}}", "{{site_url}}"].forEach(ph => {
    ensure(allowed.some(x => String(x).includes(ph)), `allowed_links contém ${ph}`);
  });

  // Models by stage
  const mbs = settings?.models_by_stage || {};
  ["recepcao","qualificacao","oferta","objeções","fechamento","posvenda"].forEach(st => {
    ensure(isNonEmptyString(mbs[st]), `models_by_stage.${st} definido`);
  });

  // Flags
  ensure(!!settings?.flags?.useModelsByStage, "flags.useModelsByStage = true");
  ensure(!!settings?.flags?.fallbackToGlobal, "flags.fallbackToGlobal = true");

  // Mensagens
  ensure(Array.isArray(settings?.messages?.opening), "messages.opening array ok");
  ensure(Array.isArray(settings?.messages?.offer_templates), "messages.offer_templates array ok");
  ensure(Array.isArray(settings?.messages?.closing), "messages.closing array ok");

  console.log("\n✅ Sanity check finalizado.");
})();
