// src/core/abrouter.js
// -----------------------------------------------------------------------------
// AbRouter neutro do core: decide variante A/B e carrega funis por bot.
// - NÃO tem cheiro de bot (Cláudia/Maria). Só pluga dinamicamente.
// - Estratégia padrão: sticky-hash por userId quando settings.abtest.enabled=true.
// - Carregamento do funil: tenta múltiplos caminhos e cai em default se não achar.
// -----------------------------------------------------------------------------

import settings from "./settings.js";

// Util
const normBotId = (id) => String(id || settings?.bot_id || "default").trim();
const hash = (s) => String(s || "")
  .split("")
  .reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0) | 0, 0);

/**
 * Decide a variante para um userId.
 * Retorno: { variant: 'A'|'B'|string|null, meta: {...} }
 */
export async function chooseVariant({ botId, userId }) {
  const cfg = settings?.abtest || {};
  const enabled = !!cfg.enabled;
  const variants = Array.isArray(cfg.variants) && cfg.variants.length
    ? cfg.variants.map(v => String(v))
    : ["A", "B"]; // padrão

  if (!enabled) return { variant: null, meta: { strategy: "disabled" } };

  const strategy = String(cfg.strategy || "sticky-hash");
  if (strategy === "sticky-hash") {
    const h = Math.abs(hash(`${normBotId(botId)}::${String(userId || "")}`));
    const idx = h % variants.length;
    return { variant: variants[idx], meta: { strategy, idx, total: variants.length } };
  }

  // Reserva para outras estratégias (ex.: thompson)
  // Hoje volta sticky-hash como fallback.
  const h = Math.abs(hash(`${normBotId(botId)}::${String(userId || "")}`));
  const idx = h % variants.length;
  return { variant: variants[idx], meta: { strategy: "sticky-hash", idx, total: variants.length } };
}

/**
 * Carrega o funil "default" do bot.
 * Convenções tentadas (em ordem):
 *  - configs/bots/<botId>/flow/funnel.js     (export default {greet,qualify,offer,close})
 *  - configs/bots/<botId>/flow/default.js
 *  - configs/bots/<botId>/flow/index.js
 *  - Compose a partir de greet.js/qualify.js/offer.js/close.js
 */
export async function loadDefaultFunnel(botId) {
  const base = `/app/configs/bots/${normBotId(botId)}/flow`;

  const tryFiles = [
    `${base}/funnel.js`,
    `${base}/default.js`,
    `${base}/index.js`,
  ];
  for (const p of tryFiles) {
    const mod = await tryImport(p);
    if (mod?.default && typeof mod.default === "object") {
      return normalizeFunnel(mod.default);
    }
  }

  // Tenta compor pelas etapas soltas
  const parts = {};
  for (const stage of ["greet", "qualify", "offer", "close"]) {
    const mod = await tryImport(`${base}/${stage}.js`);
    if (Array.isArray(mod?.default)) parts[stage] = mod.default;
    else if (typeof mod?.default === "string") parts[stage] = [mod.default];
  }
  const composed = normalizeFunnel(parts);
  if (Object.keys(composed).length) return composed;

  // Fallback vazio
  return { greet: [""], qualify: [""], offer: [""], close: [""] };
}

/**
 * Carrega o funil específico de uma variante (A/B) do bot.
 * Convenções tentadas:
 *  - funnel.<VARIANT>.js | funnel_<VARIANT>.js | <VARIANT>.js
 * Se não encontrar, cai no default.
 */
export async function loadFunnelForVariant(botId, variant) {
  const base = `/app/configs/bots/${normBotId(botId)}/flow`;
  const v = String(variant || "").trim();
  if (!v) return await loadDefaultFunnel(botId);

  const tryFiles = [
    `${base}/funnel.${v}.js`,
    `${base}/funnel_${v}.js`,
    `${base}/${v}.js`,
  ];
  for (const p of tryFiles) {
    const mod = await tryImport(p);
    if (mod?.default && typeof mod.default === "object") {
      return normalizeFunnel(mod.default);
    }
  }
  return await loadDefaultFunnel(botId);
}

// -----------------------------------------------------------------------------

function normalizeFunnel(obj) {
  const out = {};
  for (const key of ["greet", "qualify", "offer", "close"]) {
    const v = obj?.[key];
    if (typeof v === "string") out[key] = [v];
    else if (Array.isArray(v)) out[key] = v.map(x => String(x || ""));
  }
  return out;
}

async function tryImport(path) {
  try {
    // Import ESM dinâmico — o Nixpacks/Railway resolve caminho absoluto em /app
    const mod = await import(path);
    return mod;
  } catch {
    return null;
  }
}

export default { chooseVariant, loadDefaultFunnel, loadFunnelForVariant };
