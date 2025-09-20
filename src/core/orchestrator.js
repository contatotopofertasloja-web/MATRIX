// src/core/orchestrator.js
// Orquestrador determinístico: SEM LLM.
// Só fala usando frases definidas em configs/bots/<bot_id>/prompts/funnel.js.
// Mantém funil, atalhos (preço/link), anti-loop, stickiness no fechamento
// e adiciona ANTI-RAJADA + FALLBACK RANDÔMICO.

import {
  getSession, saveSession, applySlotFilling,
  setStage, advanceStage, forceStage,
  normalizeStage, shouldStickToClose, canAsk, markAsked
} from "./fsm.js";

import settings from "./settings.js"; // expõe { bot_id, product, media, guardrails, ... }
const BOT_ID = process.env.BOT_ID || settings?.bot_id || "claudia";

// ---------------- Guardrails (links & preços) ----------------
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

  // Suporta {{checkout_link}} e {{product.checkout_link}} (legado)
  const allowList = (settings?.guardrails?.allowed_links || [])
    .map(u => String(u || "")
      .replace(/\{\{\s*checkout_link\s*\}\}/g, settings?.product?.checkout_link || "")
      .replace(/\{\{\s*site_url\s*\}\}/g, settings?.product?.site_url || "")
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

// ---------------- Carregamento da copy (funnel.js) ----------------
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

// ---------------- Anti-rajada + fallback randômico ----------------
const lastReplies = new Map(); // jid -> { text, ts }
const FLOOD_MS = 8000;

function preventFlood(jid, reply) {
  const now = Date.now();
  const last = lastReplies.get(jid);
  if (last && last.text === reply && (now - last.ts) < FLOOD_MS) {
    console.log('[orchestrator] flood prevenido', { jid });
    return null;
  }
  lastReplies.set(jid, { text: reply, ts: now });
  return reply;
}

const FALLBACKS = [
  "Consegue me contar rapidinho sobre seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?)",
  "Pra te indicar certinho, me fala seu tipo de cabelo 💇‍♀️ (liso, ondulado, cacheado ou crespo)",
  "Só pra confirmar, qual é o tipo do seu cabelo? 💕 (liso, ondulado, cacheado ou crespo)"
];
function fallbackReply(seed = 0) {
  const idx = Math.abs(seed) % FALLBACKS.length;
  return FALLBACKS[idx];
}

// ---------------- Orquestração principal ----------------
/**
 * Retorna lista de ações para envio:
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

  // Atalhos por intenção
  const askedPrice = RX_ASK_PRICE.test(msg);
  const askedLink  = RX_ASK_LINK .test(msg);
  if (askedLink)  { forceStage(session, "close");  stage = "close"; }
  else if (askedPrice) { forceStage(session, "offer"); stage = "offer"; }

  // Avanço automático por preenchimento de slots
  if (stage === "greet") {
    setStage(session, "qualify"); // próxima interação já é qualify
    stage = "qualify";
  } else if (stage === "qualify") {
    const { hair_type, had_prog_before, goal } = session.slots || {};
    if (hair_type && (had_prog_before !== null && had_prog_before !== undefined) && goal) {
      setStage(session, "offer");
      stage = "offer";
    }
  } else if (stage === "offer") {
    setStage(session, "close"); // após ofertar, tende a fechar
  }

  // Variação de copy por usuário (estável)
  const variantSeed = (session.userId || "").split("").reduce((a,c)=>a+c.charCodeAt(0),0);

  // Pick copy do funil
  let copy = pickCopy(funnel, stage, variantSeed);

  // Substituições simples
  const frozenPrice = clampPrice(
    settings?.product?.price_target ?? settings?.product?.price_original
  );

  copy = String(copy || "")
    .replace(/\{\{price_target\}\}/g, String(frozenPrice))
    // aceita ambos os placeholders
    .replace(/\{\{checkout_link\}\}/g, String(settings?.product?.checkout_link || ""))
    .replace(/\{\{product\.checkout_link\}\}/g, String(settings?.product?.checkout_link || ""));

  // Guardrails
  const allowPrice = askedPrice && !STAGES_NO_PRICE.has(stage);
  copy = enforceLinks(copy);
  copy = enforcePrice(copy, { allow: allowPrice, stage });

  // -------- Envelope de ações (imagem + texto) --------
  const actions = [];

  // 1) Imagem de abertura automática — 1x por contato
  const openingUrl = settings?.media?.opening_photo_url;
  if (stage === "greet" && openingUrl && !session?.flags?.opening_photo_sent) {
    actions.push({ kind: "image", url: openingUrl, caption: "" });
    session.flags.opening_photo_sent = true;
  }

  // 2) Anti-loop de pergunta em "qualify"
  if (stage === "qualify") {
    const askId = "qualify_probe";
    if (!canAsk(session, askId)) {
      // variante curta pra não parecer erro
      copy = "Rapidinho: é **liso**, **ondulado**, **cacheado** ou **crespo**? 🙏";
    } else {
      markAsked(session, askId);
    }
  }

  // 3) Se não houve copy no funil, cai no fallback randômico
  if (!copy || !copy.trim()) {
    copy = fallbackReply(variantSeed);
    console.log('[orchestrator] Fallback acionado', { stage, jid });
  }

  // 4) Anti-rajada (bloqueia repetição igual em curto intervalo)
  const gated = preventFlood(jid, copy);
  if (gated) {
    actions.push({ kind: "text", text: gated });
  } else {
    // Se foi bloqueado por flood e ainda não enviamos nada, evita resposta vazia
    if (!actions.length) {
      // nada a enviar — apenas salva sessão e retorna
      await saveSession(session);
      return [];
    }
  }

  await saveSession(session);
  return actions;
}

export default { orchestrate };
