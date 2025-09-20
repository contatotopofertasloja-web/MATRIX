// src/core/orchestrator.js
// Orquestrador determinístico: SEM LLM (usa funnel.js).
// Copia automática de abertura, anti-loop e stickiness no fechamento.

import {
  getSession, saveSession, applySlotFilling,
  setStage, advanceStage, forceStage,
  normalizeStage, shouldStickToClose, canAsk, markAsked
} from "./fsm.js";

import settings from "./settings.js";
const BOT_ID = process.env.BOT_ID || settings?.bot_id || "claudia";

// Guardrails
const STAGES_NO_PRICE = new Set(["greet","qualify"]);
const RX_PRICE_ANY = /\bR\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?\b/g;
const RX_ASK_PRICE = /\b(preç|valor|quanto|cust)/i;
const RX_ASK_LINK  = /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho|pagamento)\b/i;

function clampPrice(price) {
  const min = settings?.guardrails?.price_min ?? 0;
  const max = settings?.guardrails?.price_max ?? Number.MAX_SAFE_INTEGER;
  return Math.max(min, Math.min(max, Number(price)||0));
}
function enforceLinks(text) {
  const allowOnly = !!settings?.guardrails?.allow_links_only_from_list;
  if (!allowOnly) return text;
  const allowList = (settings?.guardrails?.allowed_links || [])
    .map(u => String(u || "")
      .replace(/\{\{\s*checkout_link\s*\}\}/g, settings?.product?.checkout_link || "")
      .replace(/\{\{\s*site_url\s*\}\}/g, settings?.product?.site_url || "")
      .trim())
    .filter(Boolean);
  return String(text||"").replace(/\bhttps?:\/\/[^\s]+/gi, (u) => {
    const ok = allowList.some(a => u.startsWith(a));
    return ok ? u : "[link removido]";
  });
}
function enforcePrice(text, { allow=false, stage="" } = {}) {
  let out = String(text||"");
  if (!allow || STAGES_NO_PRICE.has(String(stage||"").toLowerCase())) {
    out = out.replace(RX_PRICE_ANY, "[preço disponível sob pedido]");
  }
  return out;
}

// Carrega funnel.js
async function loadFunnel(botId = BOT_ID) {
  try {
    const mod = await import(`../../configs/bots/${botId}/prompts/funnel.js`);
    return (mod?.default || {});
  } catch {
    return {};
  }
}
function pickCopy(funnel, stage, variantSeed = 0) {
  const arr = Array.isArray(funnel?.[stage]) ? funnel[stage] : [];
  if (!arr.length) return "";
  const idx = Math.abs(variantSeed) % arr.length;
  return String(arr[idx] || "");
}

// Orquestra
export async function orchestrate({ jid, text }) {
  const session = await getSession({ botId: BOT_ID, userId: jid, createIfMissing: true });
  const funnel  = await loadFunnel(BOT_ID);

  const msg = String(text || "");
  applySlotFilling(session, msg);

  let stage = normalizeStage(session.stage);

  // Stickiness
  if (shouldStickToClose(session, msg)) stage = "close";

  // Atalhos
  const askedPrice = RX_ASK_PRICE.test(msg);
  const askedLink  = RX_ASK_LINK .test(msg);
  if (askedLink)  { forceStage(session, "close");  stage = "close"; }
  else if (askedPrice) { forceStage(session, "offer"); stage = "offer"; }

  // Avanço automático
  if (stage === "greet") {
    advanceStage(session, "qualify");
    stage = "qualify";
  }

  // Pick copy
  const variantSeed = jid?.length || 0;
  let reply = pickCopy(funnel, stage, variantSeed);

  // Guardrails
  reply = enforceLinks(reply);
  reply = enforcePrice(reply, { allow: stage === "offer" || stage === "close", stage });

  saveSession(session);
  if (!reply) reply = "Oi 💕 Consegue me contar como é seu cabelo (liso, ondulado, cacheado ou crespo)?";

  return [{ kind: "text", text: reply }];
}
