// src/adapters/whatsapp/baileys/sender.js
// Camada de envio com conveniências (typing, caption safe, opções).
// Usa o adapter principal do Baileys (index.js do Baileys).

// Import robusto: funciona com export default, named ou CommonJS.
import * as _baileysMod from "./index.js";
const baileys = (_baileysMod && (_baileysMod.default ?? _baileysMod)) || {};

// =====================
// Fallback helpers (removem erro se helpers.js ainda não existe)
// Quando helpers.js existir, pode trocar para imports diretos.
// =====================
function _normalizeJid(jid) {
  const s = String(jid || "").trim();
  if (!s) return s;
  const onlyDigits = s.replace(/\D/g, "");
  if (onlyDigits && /^\d{6,20}$/.test(onlyDigits)) {
    return `${onlyDigits}@s.whatsapp.net`;
  }
  if (/@s\.whatsapp\.net$/.test(s) || /@g\.us$/.test(s)) return s;
  return s;
}

function _stripPriceUnlessAllowed(text, allow) {
  if (allow) return String(text || "");
  // remove padrões comuns de preço: R$, $, números com vírgula/ponto perto de moeda
  let t = String(text || "");
  t = t.replace(/(\bR?\$ ?\d{1,3}(\.\d{3})*(,\d{2})?\b)|(\b\d{1,3}(\.\d{3})*(,\d{2})? ?R?\$\b)/gi, "[valor]");
  return t;
}

function _stripLinksUnlessAllowed(text, allow) {
  if (allow) return String(text || "");
  let t = String(text || "");
  // URLs e @handles simples
  t = t.replace(/\bhttps?:\/\/[^\s]+/gi, "[link]");
  t = t.replace(/\bwww\.[^\s]+/gi, "[link]");
  t = t.replace(/@[a-z0-9_.-]+/gi, (m) => (m.includes("@s.whatsapp.net") ? m : "@[oculto]"));
  return t;
}

function _safeText(text, { allowPrice = false, allowLink = false } = {}) {
  let t = String(text || "");
  t = _stripPriceUnlessAllowed(t, !!allowPrice);
  t = _stripLinksUnlessAllowed(t, !!allowLink);
  return t;
}
// =====================

export async function sendText(to, text, opts = {}) {
  const jid = _normalizeJid(to);
  if (!baileys?.adapter?.sendMessage || typeof baileys.adapter.sendMessage !== "function") {
    throw new Error("[sender] baileys.adapter.sendMessage não encontrado. Verifique ./index.js do adapter.");
  }
  const payload = {
    text: _safeText(text, { allowPrice: !!opts.allowPrice, allowLink: !!opts.allowLink }),
    allowPrice: !!opts.allowPrice,
    allowLink: !!opts.allowLink,
    mentions: Array.isArray(opts.mentions) ? opts.mentions : [],
  };
  return baileys.adapter.sendMessage(jid, payload);
}

export async function sendImage(to, url, caption = "", opts = {}) {
  const jid = _normalizeJid(to);
  if (!baileys?.adapter?.sendImage || typeof baileys.adapter.sendImage !== "function") {
    throw new Error("[sender] baileys.adapter.sendImage não encontrado. Verifique ./index.js do adapter.");
  }
  const cap = _safeText(caption, { allowPrice: !!opts.allowPrice, allowLink: !!opts.allowLink });
  return baileys.adapter.sendImage(jid, url, cap, {
    allowPrice: !!opts.allowPrice,
    allowLink: !!opts.allowLink,
  });
}

export async function sendAudio(to, buffer, { mime = "audio/ogg; codecs=opus", ptt = true } = {}) {
  const jid = _normalizeJid(to);
  if (!baileys?.adapter?.sendAudio || typeof baileys.adapter.sendAudio !== "function") {
    throw new Error("[sender] baileys.adapter.sendAudio não encontrado. Verifique ./index.js do adapter.");
  }
  return baileys.adapter.sendAudio(jid, buffer, { mime, ptt });
}

export async function sendVoice(to, buffer) {
  const jid = _normalizeJid(to);
  if (!baileys?.adapter?.sendVoice || typeof baileys.adapter.sendVoice !== "function") {
    throw new Error("[sender] baileys.adapter.sendVoice não encontrado. Verifique ./index.js do adapter.");
  }
  return baileys.adapter.sendVoice(jid, buffer);
}

export default { sendText, sendImage, sendAudio, sendVoice };
