// src/core/orchestrator.js
// LLM-orquestrador: decide ação, chama tools, usa memória, aplica guardrails e retorna UMA resposta.

import { callLLM } from "./llm.js";
import { settings } from "./settings.js";
import * as tools from "./tools.js";
import * as memory from "./memory.js";
import { buildSystem, buildPlannerUser, buildRefineUser } from "./prompts/base.js";

// Helpers
const asBool = (v, d=false) => (v==null? d : ['1','true','yes','y','on'].includes(String(v).toLowerCase()));
const nowMs = () => Date.now();

function clampPrice(price, s=settings) {
  const min = s?.guardrails?.price_min ?? 0;
  const max = s?.guardrails?.price_max ?? Number.MAX_SAFE_INTEGER;
  if (price < min) return min;
  if (price > max) return max;
  return price;
}

function enforceLinks(text, s=settings) {
  const allowList = (s?.guardrails?.allow_links_only_from_list && s?.guardrails?.allowed_links) ? s.guardrails.allowed_links : null;
  if (!allowList) return text;
  // remove/mascarar urls fora da allowlist
  const urlRx = /\bhttps?:\/\/[^\s]+/gi;
  return String(text || '').replace(urlRx, (u) => {
    const ok = allowList.some(t => {
      const tmpl = String(t||'').trim();
      if (!tmpl) return false;
      // suporta template {{product.checkout_link}}
      const realized = tmpl.replace(/\{\{\s*product\.checkout_link\s*\}\}/g, settings?.product?.checkout_link || '')
                           .replace(/\{\{\s*product\.site_url\s*\}\}/g, settings?.product?.site_url || '');
      return realized && u.startsWith(realized);
    });
    return ok ? u : '[link removido]';
  });
}

function applyFreezeFields(obj={}, s=settings) {
  const fields = s?.guardrails?.freeze_fields || [];
  const frozen = {};
  for (const f of fields) {
    if (f === 'price_target') frozen.price = s?.product?.price_target ?? s?.product?.price_original;
    if (f === 'checkout_link') frozen.checkout_link = s?.product?.checkout_link;
    if (f === 'coupon_code') frozen.coupon_code = s?.product?.coupon_code;
    if (f === 'sold_count') frozen.sold_count = s?.marketing?.sold_count ?? 0;
  }
  return { ...obj, ...frozen };
}

function cooldownOk(lastTs, ms=90000) {
  if (!lastTs) return true;
  return (nowMs() - lastTs) > ms;
}

export async function orchestrate({ jid, text, stageHint, botSettings = settings }) {
  const mem = await memory.get(jid); // {slots:{}, lastLinkAt, lastOfferAt,...}
  const sys = buildSystem({ settings: botSettings });

  // PASSO 1: Planner → JSON
  const user1 = buildPlannerUser({
    message: text,
    stageHint,
    settings: botSettings,
    memory: mem
  });

  let plan;
  try {
    const { text: planStr } = await callLLM({
      stage: "planner",
      system: sys,
      prompt: user1,
      maxTokens: 512,
    });
    plan = JSON.parse(planStr || "{}");
  } catch (e) {
    console.warn("[orchestrator] planner JSON inválido, cai para fallback:", e?.message || e);
    plan = { next: "reply", stage: stageHint || "qualify", tool_calls: [], slots: {}, reply: null, confidence: 0.2 };
  }

  // Merge slots com memória e guarda
  const slots = { ...(mem?.slots || {}), ...plan?.slots };
  await memory.merge(jid, { slots });

  // PASSO 2: Executa tools solicitados
  const execResults = {};
  if (Array.isArray(plan?.tool_calls)) {
    for (const call of plan.tool_calls) {
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
  }

  // Atualiza guardrails de preço/link
  const price = clampPrice(
    botSettings?.product?.price_target ?? botSettings?.product?.price_original,
    botSettings
  );
  const frozen = applyFreezeFields({ price }, botSettings);

  // Heurística anti-loop: só permita link se usuário pediu OU cooldown passou
  const askedLink = /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho)\b/i.test(text);
  const canLink = askedLink || cooldownOk(mem?.lastLinkAt, 90000);

  // PASSO 3: Refinar resposta com dados dos tools
  const user2 = buildRefineUser({
    message: text,
    stage: plan?.stage || stageHint || "qualify",
    plan,
    tools: execResults,
    settings: botSettings,
    slots,
    guards: {
      price: frozen.price,
      checkout_allowed: canLink,
      cod_text: botSettings?.messages?.cod_short || "Pagamento na entrega (COD).",
    },
  });

  let finalText = "";
  try {
    const { text: refined } = await callLLM({
      stage: plan?.stage || "qualify",
      system: sys,
      prompt: user2,
      maxTokens: 512,
    });
    finalText = enforceLinks(refined, botSettings);
  } catch (e) {
    console.warn("[orchestrator] refine falhou:", e?.message || e);
    // fallback minimalista
    finalText = "Beleza! Posso te passar o preço e como funciona, ou quer falar de prazo e pagamento?";
  }

  // Anti-spam de link
  if (!canLink) {
    finalText = String(finalText || "").replace(/\bhttps?:\/\/[^\s]+/gi, "(posso te mandar o link quando você quiser)");
  }

  // Atualiza memória de link/offer
  if (/\bhttps?:\/\/[^\s]+/i.test(finalText)) {
    await memory.merge(jid, { lastLinkAt: nowMs() });
  } else if (/\bpreço|valor|R\$\b/i.test(finalText)) {
    await memory.merge(jid, { lastOfferAt: nowMs() });
  }

  return String(finalText || "").trim();
}
