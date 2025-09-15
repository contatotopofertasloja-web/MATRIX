// src/core/prompts/index.js
// Carregador de prompts do core com (1) suporte multi-bot, (2) validação anti-placeholder,
// (3) opção de FORÇAR o core/base por ENV ou flag no settings, e (4) fallbacks previsíveis.
//
// Ordem de resolução:
//   a) configs/bots/<bot_id>/prompts/index.js   (se válido)
//   b) src/prompts/<bot_id>/index.js            (se válido)
//   c) core/base (adaptado para builder)        (SEMPRE disponível; preferível ao antigo "product")
//   d) core/product (apenas se exportar buildPrompt)
//
// Observação importante:
//  - "Válido" significa: exporta buildPrompt({stage, message, context}) e NÃO vaza placeholders
//    como "[...]" ou strings tipo "valor disponível sob pedido" nos campos system/user.
//  - Você pode forçar o core/base com PROMPTS_FORCE_CORE=1 ou settings.flags.force_core_prompts=true.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { settings as GLOBAL_SETTINGS, BOT_ID } from "../settings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, "..", "..");

async function tryImport(href) {
  try { return await import(href); }
  catch { return null; }
}

// ----------------------------- validação -----------------------------

function hasBadPlaceholders(str = "") {
  // Evita vazamento de templates obsoletos (colchetes ou frases conhecidas)
  if (!str) return false;
  const s = String(str);
  return (
    /\[[^\]]{1,80}\]/.test(s) ||                                  // qualquer [placeholder]
    /valor\s+dispon[ií]vel\s+s[ou]b\s+pedido/i.test(s) ||         // marcador herdado
    /{{\s*[^}]+\s*}}/.test(s)                                     // handlebars não resolvido
  );
}

function isValidBuilder(fn) {
  return typeof fn === "function";
}

async function validateAndReturn(builder, { testMessage = "ping", stage = "greet" } = {}) {
  if (!isValidBuilder(builder)) return null;
  try {
    const sample = await builder({
      stage,
      message: testMessage,
      context: { settings: GLOBAL_SETTINGS }
    });

    const sys = String(sample?.system ?? "");
    const usr = String(sample?.user ?? "");
    if (!sys || !usr) return null;
    if (hasBadPlaceholders(sys) || hasBadPlaceholders(usr)) {
      console.warn("[prompts] builder rejeitado: placeholders indesejados detectados");
      return null;
    }
    return builder;
  } catch (e) {
    console.warn("[prompts] builder falhou no teste:", e?.message || e);
    return null;
  }
}

// ----------------------------- adaptação base -----------------------------

function makeBuilderFromBase(baseMod) {
  // Adapta core/prompts/base.js (que expõe buildSystem/buildPlannerUser)
  if (!baseMod?.buildSystem || !baseMod?.buildPlannerUser) return null;

  return function buildPrompt({ stage, message, context } = {}) {
    const ctxSettings = (context?.settings) || GLOBAL_SETTINGS || {};
    const system = baseMod.buildSystem({ settings: ctxSettings });
    const user   = baseMod.buildPlannerUser({
      message: message || "",
      stageHint: stage || "",
      settings: ctxSettings,
      memory: context?.memory || {},
    });
    return { system, user };
  };
}

async function loadCoreBaseBuilder() {
  const p = path.join(ROOT, "src", "core", "prompts", "base.js");
  const mod = await tryImport(pathToFileURL(p).href);
  const builder = makeBuilderFromBase(mod);
  if (!builder) throw new Error("[prompts] core/base inválido (faltam buildSystem/buildPlannerUser)");
  return builder;
}

// ----------------------------- API pública -----------------------------

export async function getPromptBuilder(botId = BOT_ID) {
  // Permite forçar o core sem desligar a pasta da bot (ótimo pra depuração/rollback)
  const FORCE_CORE =
    String(process.env.PROMPTS_FORCE_CORE || "").toLowerCase() === "1" ||
    !!GLOBAL_SETTINGS?.flags?.force_core_prompts;

  if (FORCE_CORE) {
    console.log("[prompts] FORÇANDO uso do core/base (flag/env)");
    return await loadCoreBaseBuilder();
  }

  // a) Builder específico da bot (configs/bots/<bot_id>/prompts/index.js)
  const botPrompts = path.join(ROOT, "configs", "bots", botId, "prompts", "index.js");
  let mod = await tryImport(pathToFileURL(botPrompts).href);
  if (mod?.buildPrompt) {
    const ok = await validateAndReturn(mod.buildPrompt);
    if (ok) return ok;
    console.warn("[prompts] builder da bot inválido → fallback");
  }

  // b) Builder alternativo (src/prompts/<bot_id>/index.js)
  const alt = path.join(ROOT, "src", "prompts", botId, "index.js");
  mod = await tryImport(pathToFileURL(alt).href);
  if (mod?.buildPrompt) {
    const ok = await validateAndReturn(mod.buildPrompt);
    if (ok) return ok;
    console.warn("[prompts] builder alternativo inválido → fallback");
  }

  // c) Core/base (adaptado) — seguro e sempre presente
  try {
    const base = await loadCoreBaseBuilder();
    const ok   = await validateAndReturn(base);
    if (ok) return ok;
  } catch (e) {
    console.warn("[prompts] core/base indisponível:", e?.message || e);
  }

  // d) Core/product (apenas se exportar buildPrompt)
  const coreProduct = path.join(ROOT, "src", "core", "prompts", "products.js");
  mod = await tryImport(pathToFileURL(coreProduct).href);
  if (mod?.buildPrompt) {
    const ok = await validateAndReturn(mod.buildPrompt);
    if (ok) return ok;
  }

  throw new Error("[prompts] Nenhum buildPrompt válido encontrado (bot/base/product).");
}

export default { getPromptBuilder };
