// src/core/orchestrator.js
// Orquestrador determinístico: SEM LLM.
// Agora com A/B de funil (Copy A vs Copy B) sticky por usuário.
// Mantém: LOCK por JID, anti-rajada/persistência, debounce inbound, guardrails.

import {
  getSession, saveSession, applySlotFilling,
  setStage, forceStage,
  normalizeStage, shouldStickToClose, canAsk, markAsked
} from "./fsm.js";
import settings from "./settings.js";
import { chooseVariant, loadFunnelForVariant, loadDefaultFunnel } from "./abrouter.js";

const BOT_ID = process.env.BOT_ID || settings?.bot_id || "claudia";

// Proteções
const FLOOD_MS_SAME_REPLY = 8000;
const DEBOUNCE_MS_INBOUND = 3500;
const PROCESSING_LOCK_MS  = 10000;

const processingLocks = new Map();
function tryAcquireLock(jid) {
  const now = Date.now();
  const ts = processingLocks.get(jid);
  if (ts && (now - ts) < PROCESSING_LOCK_MS) return false;
  processingLocks.set(jid, now);
  return true;
}
function releaseLock(jid) { processingLocks.delete(jid); }

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
function expandAllowedLinks(list = []) {
  return list
    .map(u => String(u || "")
      .replace(/\{\{\s*checkout_link\s*\}\}/g, settings?.product?.checkout_link || "")
      .replace(/\{\{\s*site_url\s*\}\}/g, settings?.product?.site_url || "")
      .replace(/\{\{\s*product\.checkout_link\s*\}\}/g, settings?.product?.checkout_link || "")
      .replace(/\{\{\s*product\.site_url\s*\}\}/g, settings?.product?.site_url || "")
      .trim())
    .filter(Boolean);
}
function enforceLinks(text) {
  const allowOnly = !!settings?.guardrails?.allow_links_only_from_list;
  if (!allowOnly) return text;
  const allowList = expandAllowedLinks(settings?.guardrails?.allowed_links || []);
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

// Carregamento do funil (A/B ou padrão)
async function loadFunnel(botId, jid) {
  const ab = await chooseVariant({ botId, userId: jid }).catch(() => null);
  if (!ab?.variant) {
    return { funnel: await loadDefaultFunnel(botId), variant: null };
  }
  const f = await loadFunnelForVariant(botId, ab.variant);
  return { funnel: f, variant: ab.variant };
}

function pickCopy(funnel, stage, variantSeed = 0) {
  const arr = Array.isArray(funnel?.[stage]) ? funnel[stage] : [];
  if (!arr.length) return "";
  const idx = Math.abs(variantSeed) % arr.length;
  return String(arr[idx] || "");
}

// Fallback randômico
const FALLBACKS = [
  "Consegue me contar rapidinho sobre seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?)",
  "Pra te indicar certinho, me fala seu tipo de cabelo 💇‍♀️ (liso, ondulado, cacheado ou crespo)",
  "Só pra confirmar, qual é o tipo do seu cabelo? 💕 (liso, ondulado, cacheado ou crespo)"
];
function fallbackReply(seed = 0) {
  const idx = Math.abs(seed) % FALLBACKS.length;
  return FALLBACKS[idx];
}

// Persistência de inbound/outbound p/ anti-rajada
function shouldDebounceInbound(session, msg) {
  const now = Date.now();
  const lastTxt = session?.flags?.last_user_text || "";
  const lastTs  = session?.flags?.last_user_ts || 0;
  const same    = lastTxt === msg;
  const close   = (now - lastTs) < DEBOUNCE_MS_INBOUND;
  return same && close;
}
function markInbound(session, msg) {
  session.flags = session.flags || {};
  session.flags.last_user_text = msg;
  session.flags.last_user_ts   = Date.now();
}
function shouldBlockSameReply(session, replyText) {
  const now = Date.now();
  const last = session?.flags?.last_reply_text || "";
  const lastTs = session?.flags?.last_reply_ts || 0;
  const same = last === replyText;
  const close = (now - lastTs) < FLOOD_MS_SAME_REPLY;
  return same && close;
}
function markReply(session, replyText) {
  session.flags = session.flags || {};
  session.flags.last_reply_text = replyText;
  session.flags.last_reply_ts   = Date.now();
}

/**
 * Saída: [{ kind:'image', url, caption }, { kind:'text', text, meta:{variant,stage} }]
 */
export async function orchestrate({ jid, text }) {
  if (!tryAcquireLock(jid)) {
    console.log("[orchestrator] lock negado (concurrency)", { jid });
    return [];
  }
  try {
    const actions = []; // ← centraliza todas as saídas
    const session = await getSession({ botId: BOT_ID, userId: jid, createIfMissing: true });
    const { funnel, variant } = await loadFunnel(BOT_ID, jid);

    const msg = String(text || "");

    if (shouldDebounceInbound(session, msg)) {
      console.log("[orchestrator] inbound debounced", { jid, msg });
      return [];
    }
    markInbound(session, msg);

    applySlotFilling(session, msg);

    let stage = normalizeStage(session.stage);
    if (shouldStickToClose(session, msg)) stage = "close";

    const askedPrice = RX_ASK_PRICE.test(msg);
    const askedLink  = RX_ASK_LINK .test(msg);
    if (askedLink)  { forceStage(session, "close");  stage = "close"; }
    else if (askedPrice) { forceStage(session, "offer"); stage = "offer"; }

    if (stage === "greet") {
      // envia imagem de abertura 1x
      const openingUrl = settings?.media?.opening_photo_url;
      if (openingUrl && !session?.flags?.opening_photo_sent) {
        actions.push({ kind: "image", url: openingUrl, caption: "", meta: { variant, stage: "greet" } });
        session.flags.opening_photo_sent = true;
      }
      // segue pro qualify
      session.stage = "qualify";
      stage = "qualify";
      await saveSession(session);
      // continua para também enviar o texto da etapa "qualify"
    }

    // Semente estável por usuário
    const variantSeed = (session.userId || "").split("").reduce((a,c)=>a+c.charCodeAt(0),0);

    let copy = pickCopy(funnel, stage, variantSeed);

    // Placeholders/guardrails
    const frozenPrice = clampPrice(settings?.product?.price_target ?? settings?.product?.price_original);
    copy = String(copy || "")
      .replace(/\{\{price_target\}\}/g, String(frozenPrice))
      .replace(/\{\{checkout_link\}\}/g, String(settings?.product?.checkout_link || ""))
      .replace(/\{\{\s*product\.checkout_link\s*\}\}/g, String(settings?.product?.checkout_link || ""));

    const allowPrice = askedPrice && !STAGES_NO_PRICE.has(stage);
    copy = enforceLinks(copy);
    copy = enforcePrice(copy, { allow: allowPrice, stage });

    // Anti-loop em "qualify"
    if (stage === "qualify") {
      const askId = "qualify_probe";
      if (!canAsk(session, askId)) {
        copy = "Rapidinho: é **liso**, **ondulado**, **cacheado** ou **crespo**? 🙏";
      } else {
        markAsked(session, askId);
      }
    }

    if (!copy || !copy.trim()) {
      copy = fallbackReply(variantSeed);
      console.log("[orchestrator] fallback acionado", { stage, jid });
    }

    if (shouldBlockSameReply(session, copy)) {
      console.log("[orchestrator] reply bloqueada por flood", { jid });
      await saveSession(session);
      return []; // preserva silêncio p/ evitar rajada
    }
    markReply(session, copy);

    // Avanço natural de estágios (qualify→offer→close)
    if (stage === "qualify") {
      const { hair_type, had_prog_before, goal } = session.slots || {};
      if (hair_type && (had_prog_before !== null && had_prog_before !== undefined) && goal) {
        session.stage = "offer";
      }
    } else if (stage === "offer") {
      session.stage = "close";
    }

    // empilha a resposta de texto já com meta.variant e meta.stage
    actions.push({ kind: "text", text: copy, meta: { variant, stage: session.stage } });

    // ======= SALVA E CAPTURA MÉTRICAS (tua linha proposta) =======
    await saveSession(session);
    try {
      const { captureFromActions } = await import("./metrics/middleware.js");
      // askedPrice/askedLink já calculados acima
      await captureFromActions(actions, {
        botId: BOT_ID,
        jid,
        stage: session.stage,
        variant: (actions.find(a => a?.meta?.variant)?.meta?.variant) || null,
        askedPrice,
        askedLink,
      });
    } catch (e) { console.warn("[metrics] skip:", e?.message || e); }
    // =============================================================

    return actions;
  } finally {
    releaseLock(jid);
  }
}

export default { orchestrate };
