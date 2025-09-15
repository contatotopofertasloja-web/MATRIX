// src/core/orchestrator.js
import { callLLM } from "./llm.js";
import { settings } from "../../configs/src/core/settings.js";
import * as tools from "./tools.js";
import * as memory from "./memory.js";
import { buildSystem, buildPlannerUser, buildRefineUser } from "./prompts/base.js";
import { sanitizeOutbound } from "../utils/polish.js";

const nowMs = () => Date.now();
const COOLDOWN_MS = 90_000;

const STAGES_NO_PRICE = new Set(["greet","qualify","faq","recepcao","qualificacao"]);
const RX_PRICE_ANY = /\bR\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?\b/g;
const RX_ASK_PRICE = /\b(preç|valor|quanto|cust)/i;
const RX_ASK_LINK  = /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho)\b/i;

function cooldownOk(lastTs, ms=COOLDOWN_MS) {
  return !lastTs || (nowMs() - lastTs) > ms;
}

function clampPrice(price, s=settings) {
  const min = s?.guardrails?.price_min ?? 0;
  const max = s?.guardrails?.price_max ?? Number.MAX_SAFE_INTEGER;
  return Math.max(min, Math.min(max, Number(price)||0));
}

function enforceLinks(text, s=settings) {
  if (!s?.guardrails?.allow_links_only_from_list) return text;
  const allowList = (s.guardrails.allowed_links || []).map(t =>
    String(t||"")
      .replace(/\{\{\s*product\.checkout_link\s*\}\}/g, s?.product?.checkout_link || "")
      .replace(/\{\{\s*product\.site_url\s*\}\}/g, s?.product?.site_url || "")
      .trim()
  ).filter(Boolean);

  return String(text||"").replace(/\bhttps?:\/\/[^\s]+/gi, (u) => {
    const ok = allowList.some(allowed => u.startsWith(allowed));
    return ok ? u : "[link removido]";
  });
}

// NOVO: além de números, limita menções em estágios bloqueados
function enforcePrice(text, { allow=false, stage="" } = {}) {
  let out = String(text||"");
  if (!allow || STAGES_NO_PRICE.has(String(stage||"").toLowerCase())) {
    out = out.replace(RX_PRICE_ANY, "[preço disponível sob pedido]");
    // neutraliza frases do tipo "o preço é ...", "custa ..."
    out = out
      .replace(/\b(preço|preco)\s*(é|esta|fica)\s*\[preço disponível sob pedido\]/gi, "posso te informar o valor quando quiser")
      .replace(/\bcusta\s*\[preço disponível sob pedido\]/gi, "tem um valor que posso te informar quando quiser");
  }
  return out;
}

export async function orchestrate({ jid, text, stageHint, botSettings = settings }) {
  const mem = await memory.get(jid) || {};
  const sys = buildSystem({ settings: botSettings });

  const user1 = buildPlannerUser({ message: text, stageHint, settings: botSettings, memory: mem });

  let plan;
  try {
    const { text: planStr } = await callLLM({ stage: "planner", system: sys, prompt: user1, maxTokens: 512 });
    plan = JSON.parse(planStr || "{}");
  } catch {
    plan = { next: "reply", stage: stageHint || "qualify", tool_calls: [], slots: {}, reply: null, confidence: 0.2 };
  }

  const slots = { ...(mem.slots || {}), ...(plan.slots || {}) };
  await memory.merge(jid, { slots });

  const askedPrice = RX_ASK_PRICE.test(text || "");
  const askedLink  = RX_ASK_LINK .test(text || "");

  const canPrice = askedPrice || cooldownOk(mem.lastOfferAt);
  const canLink  = askedLink  || cooldownOk(mem.lastLinkAt);

  const execResults = {};
  const stage = String(plan?.stage || stageHint || "qualify").toLowerCase();

  const safeToolCalls = Array.isArray(plan?.tool_calls) ? plan.tool_calls.filter(tc => {
    const name = String(tc?.name || "").trim();
    if (/getPrice/i.test(name))      return canPrice && !STAGES_NO_PRICE.has(stage);
    if (/getCheckoutLink/i.test(name)) return canLink;
    return true;
  }) : [];

  for (const call of safeToolCalls) {
    const name = String(call?.name || "").trim();
    const args = call?.args || {};
    try {
      if (typeof tools[name] === "function") {
        execResults[name] = await tools[name]({ jid, args, settings: botSettings, memory: { get: () => memory.get(jid) } });
      }
    } catch (e) {
      execResults[name] = { error: String(e?.message || e) };
    }
  }

  const frozenPrice = clampPrice(
    botSettings?.product?.price_target ?? botSettings?.product?.price_original,
    botSettings
  );

  const user2 = buildRefineUser({
    message: text,
    stage,
    plan,
    tools: execResults,
    settings: botSettings,
    slots,
    guards: {
      price: frozenPrice,
      price_allowed: canPrice && !STAGES_NO_PRICE.has(stage),
      checkout_allowed: canLink,
      cod_text: botSettings?.messages?.cod_short || "Pagamento na entrega (COD).",
    },
  });

  let finalText = "";
  try {
    const { text: refined } = await callLLM({ stage, system: sys, prompt: user2, maxTokens: 512 });
    finalText = refined;
  } catch {
    finalText = "Posso te explicar como funciona, prazos e pagamento, ou prefere saber do valor?";
  }

  // Primeira barreira (allowlist de link + neutralização de números)
  finalText = enforceLinks(finalText, botSettings);
  finalText = enforcePrice(finalText, { allow: canPrice, stage });

  // Segunda barreira (sanitizador final, inclusive MENÇÕES sem número)
  finalText = sanitizeOutbound(finalText, {
    allowPrice: canPrice && !STAGES_NO_PRICE.has(stage),
    allowLink: canLink,
  });

  // memória anti-spam
  if (/\bhttps?:\/\/[^\s]+/i.test(finalText)) await memory.merge(jid, { lastLinkAt: nowMs() });
  if (RX_PRICE_ANY.test(finalText) || askedPrice) await memory.merge(jid, { lastOfferAt: nowMs() });

  return String(finalText || "").trim();
}

export default { orchestrate };
