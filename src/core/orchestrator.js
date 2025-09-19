// src/core/orchestrator.js
// Orquestrador determinístico: SEM LLM.
// Só fala usando frases definidas em configs/bots/<bot_id>/prompts/funnel.js.
// Reintroduz envio automático da imagem de abertura (media.opening_photo_url).
// Mantém funil, atalhos (preço/link), anti-loop e stickiness no fechamento.

import {
  getSession, saveSession, applySlotFilling,
  setStage, advanceStage, forceStage,
  normalizeStage, shouldStickToClose, canAsk, markAsked
} from "./fsm.js";

import settings from "./settings.js"; // assume que expõe { bot_id, product, media, guardrails, ... }
const BOT_ID = process.env.BOT_ID || settings?.bot_id || "claudia";

// --------- Guardrails (links & preços) ---------
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
      .replace(/\{\{\s*product\.checkout_link\s*\}\}/g, settings?.product?.checkout_link || "")
      .replace(/\{\{\s*product\.site_url\s*\}\}/g, settings?.product?.site_url || "")
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

// --------- Carregamento da copy (funnel.js) ---------
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

// --------- Orquestração principal ---------
/**
 * Retorna uma lista de "ações" para a camada de envio (mantém compat com dispatcher):
 * [{ kind:'image', url, caption }, { kind:'text', text }]
 */
export async function orchestrate({ jid, text }) {
  const session = await getSession({ botId: BOT_ID, userId: jid, createIfMissing: true });
  const funnel  = await loadFunnel(BOT_ID);

  const msg = String(text || "");
  applySlotFilling(session, msg);

  let stage = normalizeStage(session.stage);

  // Stickiness do fechamento
  if (shouldStickToClose(session, msg)) stage = "close";

  // Atalhos
  const askedPrice = RX_ASK_PRICE.test(msg);
  const askedLink  = RX_ASK_LINK .test(msg);
  if (askedLink)  { forceStage(session, "close");  stage = "close"; }
  else if (askedPrice) { forceStage(session, "offer"); stage = "offer"; }

  // Avanço automático por preenchimento de slots
  if (stage === "greet") {
    // logo após a saudação, próxima interação já é qualify
    setStage(session, "qualify");
  } else if (stage === "qualify") {
    const { hair_type, had_prog_before, goal } = session.slots || {};
    if (hair_type && (had_prog_before !== null && had_prog_before !== undefined) && goal) {
      setStage(session, "offer");
      stage = "offer";
    }
  } else if (stage === "offer") {
    // depois de oferecer, tendência é fechar
    setStage(session, "close");
  }

  const variantSeed = (session.userId || "").split("").reduce((a,c)=>a+c.charCodeAt(0),0);
  let copy = pickCopy(funnel, stage, variantSeed);

  // Substituições simples
  const frozenPrice = clampPrice(
    settings?.product?.price_target ?? settings?.product?.price_original
  );
  copy = copy
    .replace(/\{\{price_target\}\}/g, String(frozenPrice))
    .replace(/\{\{checkout_link\}\}/g, String(settings?.product?.checkout_link || ""));

  // Guardrails
  const allowPrice = askedPrice && !STAGES_NO_PRICE.has(stage);
  copy = enforceLinks(copy);
  copy = enforcePrice(copy, { allow: allowPrice, stage });

  // -------- ENVELOPE DE AÇÕES (texto + imagem de abertura) --------
  const actions = [];

  // 1) Imagem de abertura automática — NÃO repetir
  const openingUrl = settings?.media?.opening_photo_url;
  if (stage === "greet" && openingUrl && !session?.flags?.opening_photo_sent) {
    actions.push({ kind: "image", url: openingUrl, caption: "" });
    session.flags.opening_photo_sent = true; // não dispara de novo
  }

  // 2) Anti-loop: em qualify, só repete pergunta se cooldown liberar
  if (stage === "qualify") {
    const askId = "qualify_probe";
    if (!canAsk(session, askId)) {
      // Evita “Me dá só essa info…” em loop -> usa uma variante de reforço curta
      copy = "Rapidinho: é **liso**, **ondulado**, **cacheado** ou **crespo**? 🙏";
    } else {
      markAsked(session, askId);
    }
  }

  if (copy.trim()) {
    actions.push({ kind: "text", text: copy });
  }

  await saveSession(session);
  return actions;
}

export default { orchestrate };
