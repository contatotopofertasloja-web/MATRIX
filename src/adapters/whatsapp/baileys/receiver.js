// src/adapters/whatsapp/baileys/receiver.js
// Camada de recepção com dedupe e detecção básica de mídia.
// Encaminha para o handler de aplicação (ex.: pipeline -> orchestrator).

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
  // remove chars não numéricos + sufixo se for número puro
  const onlyDigits = s.replace(/\D/g, "");
  if (onlyDigits && /^\d{6,20}$/.test(onlyDigits)) {
    return `${onlyDigits}@s.whatsapp.net`;
  }
  // já vem no formato JID
  if (/@s\.whatsapp\.net$/.test(s) || /@g\.us$/.test(s)) return s;
  // fallback: retorna como veio
  return s;
}

// dedupe simples por JID+hash(text) com janela deslizante
const _dedupeCache = new Map(); // key -> expiresAt (ms)
function _isDuplicate({ jid, text, windowMs = 3500 }) {
  const now = Date.now();
  // limpeza simples
  for (const [k, exp] of _dedupeCache) {
    if (exp <= now) _dedupeCache.delete(k);
  }
  const key = `${jid}::${_hashText(text)}`;
  const hit = _dedupeCache.get(key);
  if (hit && hit > now) return true;
  _dedupeCache.set(key, now + Math.max(500, windowMs | 0));
  return false;
}
function _hashText(t) {
  const s = String(t || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

// =====================

let _appHandler = null;

/**
 * Registra o handler de aplicação.
 * @param {(evt: { from: string, text: string, hasMedia: boolean, raw: any }) => Promise<void>} fn
 */
export function onAppMessage(fn) {
  _appHandler = typeof fn === "function" ? fn : null;
}

/** Liga a ponte do adapter Baileys para o handler de aplicação */
export async function attach() {
  if (!baileys?.adapter?.onMessage || typeof baileys.adapter.onMessage !== "function") {
    console.error("[receiver] baileys.adapter.onMessage não encontrado. Verifique ./index.js do adapter.");
    return;
  }

  baileys.adapter.onMessage(async ({ from, text, hasMedia, raw }) => {
    try {
      const jid = _normalizeJid(from);
      const msg = String(text ?? "");

      // Debounce de duplicados (duplicidades comuns do WhatsApp/worker)
      if (_isDuplicate({ jid, text: msg, windowMs: 3500 })) {
        return;
      }

      if (_appHandler) {
        await _appHandler({ from: jid, text: msg, hasMedia: !!hasMedia, raw });
      }
    } catch (e) {
      console.error("[receiver] erro no onMessage:", e?.message || e);
    }
  });
}

export default { onAppMessage, attach };
