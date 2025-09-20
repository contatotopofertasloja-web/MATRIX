// src/core/orchestrator.js
// Orquestrador determinístico: SEM LLM.
// Copys de configs/bots/<bot_id>/prompts/funnel.js.
// Proteções adicionadas: LOCK por JID, anti-rajada PERSISTENTE e debounce do inbound.

import {
  getSession, saveSession, applySlotFilling,
  setStage, advanceStage, forceStage,
  normalizeStage, shouldStickToClose, canAsk, markAsked
} from "./fsm.js";

import settings from "./settings.js"; // { bot_id, product, media, guardrails, ... }
const BOT_ID = process.env.BOT_ID || settings?.bot_id || "claudia";

// --------------------------------- Constantes de proteção ---------------------------------
const FLOOD_MS_SAME_REPLY = 8000;     // bloqueia envio da MESMA reply em < 8s
const DEBOUNCE_MS_INBOUND  = 3500;    // ignora MESMA mensagem do usuário em < 3.5s (duplicata)
const PROCESSING_LOCK_MS   = 10000;   // trava reentrância por JID (failsafe)

// Lock em memória para evitar paralelismo por JID (mesmo processo)
const processingLocks = new Map(); // jid -> tsLock

function tryAcquireLock(jid) {
  const now = Date.now();
  const ts = processingLocks.get(jid);
  if (ts && (now - ts) < PROCESSING_LOCK_MS) return false;
  processingLocks.set(jid, now);
  return true;
}
function releaseLock(jid) {
  processingLocks.delete(jid);
}

// --------------------------------- Guardrails (links & preços) ---------------------------------
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
      // suporta placeholders nas duas formas
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

// --------------------------------- Copy (funnel.js) ---------------------------------
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

// --------------------------------- Fallback randômico ---------------------------------
const FALLBACKS = [
  "Consegue me contar rapidinho sobre seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?)",
  "Pra te indicar certinho, me fala seu tipo de cabelo 💇‍♀️ (liso, ondulado, cacheado ou crespo)",
  "Só pra confirmar, qual é o tipo do seu cabelo? 💕 (liso, ondulado, cacheado ou crespo)"
];
function fallbackReply(seed = 0) {
  const idx = Math.abs(seed) % FALLBACKS.length;
  return FALLBACKS[idx];
}

// --------------------------------- Helpers persistentes em sessão ---------------------------------
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

// --------------------------------- Orquestração ---------------------------------
/**
 * Retorna lista de ações para envio:
 * [{ kind:'image', url, caption }, { kind:'text', text }]
 */
export async function orchestrate({ jid, text }) {
  // LOCK por JID — evita reentrância paralela
  if (!tryAcquireLock(jid)) {
    console.log("[orchestrator] lock negado (concurrency)", { jid });
    return [];
  }

  try {
    const session = await getSession({ botId: BOT_ID, userId: jid, createIfMissing: true });
    const funnel  = await loadFunnel(BOT_ID);

    const msg = String(text || "");

    // Debounce de inbound (duplicatas em poucos ms do mesmo "oi")
    if (shouldDebounceInbound(session, msg)) {
      console.log("[orchestrator] inbound debounced", { jid, msg });
      return [];
    }
    markInbound(session, msg);

    applySlotFilling(session, msg);

    let stage = normalizeStage(session.stage);

    // Stickiness: se já está em fechamento, permanece
    if (shouldStickToClose(session, msg)) stage = "close";

    // Atalhos
    const askedPrice = RX_ASK_PRICE.test(msg);
    const askedLink  = RX_ASK_LINK .test(msg);
    if (askedLink)  { forceStage(session, "close");  stage = "close"; }
    else if (askedPrice) { forceStage(session, "offer"); stage = "offer"; }

    // Avanço de estágios (determinístico)
    if (stage === "greet") {
      setStage(session, "qualify");
      stage = "qualify";
    } else if (stage === "qualify") {
      const { hair_type, had_prog_before, goal } = session.slots || {};
      if (hair_type && (had_prog_before !== null && had_prog_before !== undefined) && goal) {
        setStage(session, "offer");
        stage = "offer";
      }
    } else if (stage === "offer") {
      setStage(session, "close");
      stage = "close";
    }

    // Semente estável por usuário
    const variantSeed = (session.userId || "").split("").reduce((a,c)=>a+c.charCodeAt(0),0);

    // Escolhe copy do funil
    let copy = pickCopy(funnel, stage, variantSeed);

    // Placeholders
    const frozenPrice = clampPrice(
      settings?.product?.price_target ?? settings?.product?.price_original
    );
    copy = String(copy || "")
      .replace(/\{\{price_target\}\}/g, String(frozenPrice))
      .replace(/\{\{checkout_link\}\}/g, String(settings?.product?.checkout_link || ""))
      .replace(/\{\{\s*product\.checkout_link\s*\}\}/g, String(settings?.product?.checkout_link || ""));

    // Guardrails
    const allowPrice = askedPrice && !STAGES_NO_PRICE.has(stage);
    copy = enforceLinks(copy);
    copy = enforcePrice(copy, { allow: allowPrice, stage });

    // Envelope de ações
    const actions = [];

    // 1) Imagem de abertura automática 1x
    const openingUrl = settings?.media?.opening_photo_url;
    if (stage === "greet" && openingUrl && !session?.flags?.opening_photo_sent) {
      actions.push({ kind: "image", url: openingUrl, caption: "" });
      session.flags.opening_photo_sent = true;
    }

    // 2) Anti-loop de pergunta em "qualify"
    if (stage === "qualify") {
      const askId = "qualify_probe";
      if (!canAsk(session, askId)) {
        copy = "Rapidinho: é **liso**, **ondulado**, **cacheado** ou **crespo**? 🙏";
      } else {
        markAsked(session, askId);
      }
    }

    // 3) Fallback randômico se não houver copy
    if (!copy || !copy.trim()) {
      copy = fallbackReply(variantSeed);
      console.log("[orchestrator] fallback acionado", { stage, jid });
    }

    // 4) Anti-rajada PERSISTENTE (não mandar a MESMA resposta em < FLOOD_MS_SAME_REPLY)
    if (shouldBlockSameReply(session, copy)) {
      console.log("[orchestrator] reply bloqueada por flood", { jid });
      await saveSession(session);
      return actions.length ? actions : []; // preserva a imagem de abertura, se houver
    }
    markReply(session, copy);

    // 5) Enfileira texto
    actions.push({ kind: "text", text: copy });

    await saveSession(session);
    return actions;

  } finally {
    releaseLock(jid);
  }
}

export default { orchestrate };
