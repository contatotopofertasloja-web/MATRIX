// src/core/prompts/index.js
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { settings as GLOBAL_SETTINGS, BOT_ID } from "../settings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, "..", "..");

async function tryImport(href) { try { return await import(href); } catch { return null; } }

function hasBadPlaceholders(s="") {
  const t = String(s||"");
  return /\[[^\]]{1,80}\]/.test(t) || /valor\s+dispon[ií]vel\s+s[ou]b\s+pedido/i.test(t) || /{{\s*[^}]+\s*}}/.test(t);
}
async function validateBuilder(builder) {
  if (typeof builder !== "function") return null;
  try {
    const sample = await builder({ stage: "greet", message: "ping", context: { settings: GLOBAL_SETTINGS } });
    const sys = String(sample?.system ?? "");
    const usr = String(sample?.user ?? "");
    if (!sys || !usr) return null;
    if (hasBadPlaceholders(sys) || hasBadPlaceholders(usr)) return null;
    return builder;
  } catch { return null; }
}
function adaptBase(baseMod) {
  if (!baseMod?.buildSystem || !baseMod?.buildPlannerUser) return null;
  return async ({ stage, message, context }) => {
    const system = baseMod.buildSystem({ settings: context?.settings || GLOBAL_SETTINGS });
    const user   = baseMod.buildPlannerUser({ message, stageHint: stage, settings: context?.settings || GLOBAL_SETTINGS });
    return { system, user };
  };
}

export async function loadPromptBuilder() {
  // a) prompts da bot
  const a = await tryImport(pathToFileURL(path.join(ROOT, "configs", "bots", BOT_ID, "prompts", "index.js")).href);
  const aBuilder = await validateBuilder(a?.buildPrompt || a?.default);
  if (aBuilder && !GLOBAL_SETTINGS?.flags?.force_core_prompts) return aBuilder;

  // c) core/base
  const base = await tryImport(pathToFileURL(path.join(ROOT, "src", "core", "prompts", "base.js")).href);
  const baseB = adaptBase(base);
  const baseBuilder = await validateBuilder(baseB);
  if (baseBuilder) return baseBuilder;

  // d) core/products (compat)
  const prod = await tryImport(pathToFileURL(path.join(ROOT, "src", "core", "prompts", "products.js")).href);
  const prodB = await validateBuilder(prod?.buildPrompt);
  if (prodB) return prodB;

  throw new Error("[prompts] Nenhum builder válido encontrado");
}
