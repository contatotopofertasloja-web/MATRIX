// configs/bots/claudia/flow/_state.js
// Estado curto + helpers + carimbo (flow/*) com whitelist de links e gating anti-rajada.

export function initialState() {
  return {
    // identificação & qualificação
    profile: { name: null },
    hair_type: null,          // liso | ondulado | cacheado | crespo
    had_prog_before: null,    // boolean | null
    goal: null,               // "liso" | "alinhado/menos frizz"...

    // intenções rápidas
    price_allowed: false,
    link_allowed: false,
    consent_checkout: false,

    // controle de fluxo
    turns: 0,
    __sent_opening_photo: false,
    __boot_greet_done: false,

    // antifluxo / antiflood
    __gate: {},               // mapa { chave: timestamp }
  };
}

/** Whitelist de links para evitar vazamento */
function whitelist(settings = {}) {
  return new Set(
    [
      settings?.product?.checkout_link,
      settings?.product?.site_url,
      ...(settings?.guardrails?.allowed_links || []),
    ]
      .map((u) => String(u || ""))
      .filter((u) => /^https?:\/\//i.test(u))
  );
}

/** Carimba SOMENTE se debug estiver ativo */
export function tagReply(settings = {}, text = "", tag = "flow") {
  const wl = whitelist(settings);
  const safe = String(text || "").replace(/https?:\/\/\S+/gi, (u) => (wl.has(u) ? u : "[link removido]"));
  const debug = !!settings?.flags?.debug_trace_replies;
  return debug && tag ? `${safe} (${tag})` : safe;
}

/** Nome do usuário (quando conhecido) */
export function callUser(state = {}) {
  const name = state?.profile?.name || state?.name;
  if (!name) return null;
  const clean = String(name).trim();
  return clean || null;
}

/**
 * Gating anti-rajada: retorna true se ainda está em janela de bloqueio.
 * Ex.: if (gate(state,'boot_greet', 4000)) return { reply: null };
 */
export function gate(state = {}, key = "", ms = 3000) {
  if (!key) return false;
  const now = Date.now();
  state.__gate = state.__gate || {};
  const last = state.__gate[key] || 0;
  if (now - last < ms) return true;
  state.__gate[key] = now;
  return false;
}

/** Utilitário de número -> string “inteiro” */
export function n(v, d = 0) {
  return Number.isFinite(+v) ? (+v).toFixed(0) : String(v ?? d);
}

/** Atalhos fixos do produto (opcional) */
export function getFixed(settings = {}) {
  const p = settings?.product || {};
  return {
    priceOriginal: +p.price_original || 0,
    priceTarget: +p.price_target || 0,
    slaCap: +(p?.delivery_sla?.capitals_hours ?? 24),
    slaOthers: +(p?.delivery_sla?.others_hours ?? 72),
    checkout: String(p.checkout_link || ""),
    site: String(p.site_url || ""),
  };
}
