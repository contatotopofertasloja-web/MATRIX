// configs/bots/claudia/flow/_state.js
// (base preservada)
export function initialState() {
  return {
    nome: null,
    apelido: null,
    tipo_cabelo: null,
    objetivo: null,
    asked_price_once: false,
    asked_name_once: false,
    asked_hair_once: false,
    consent_checkout: false,
    price_allowed: false,
    turns: 0,
    telefone: null,
    cep: null,
    rua: null,
    numero: null,
    complemento: null,
    bairro: null,
    cidade: null,
    uf: null,
    referencia: null,
    stage: "recepcao",
    last_intent: null,
  };
}

const CARINHOS = ["minha linda", "amor", "gata", "minha flor"];
export function callUser(state = {}) {
  const nome = (state?.nome || "").trim();
  if (nome && Math.random() < 0.6) return nome.split(" ")[0];
  if (!state._apx) state._apx = 0;
  const ap = CARINHOS[state._apx % CARINHOS.length];
  state._apx++;
  return ap;
}

function numEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const n = Number(String(raw).replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

export function getFixed(settings = {}) {
  const s = settings || {};
  const empresa = s.company_name || "TopOfertas";
  const hora = `${s?.business?.hours_start || "06:00"}–${s?.business?.hours_end || "21:00"}`;
  const sorteioOn = !!s?.sweepstakes?.enabled;
  const sorteioTeaser = (s?.sweepstakes?.messages?.teaser || [])[0] || "Atualmente, não temos sorteios ativos.";

  const product = s.product || {};
  const priceOriginal = numEnv("PRICE_ORIGINAL", product.price_original ?? 197);
  const priceTarget   = numEnv("PRICE_TARGET",   product.price_target   ?? 170);

  return {
    empresa,
    hora,
    sorteioOn,
    sorteioTeaser,
    priceOriginal,
    priceTarget,
    applications: product.applications_range || "até 10 aplicações",
    duration: product.duration_avg || "em média 3 meses",
    soldCount: s?.marketing?.sold_count || 40000,
    hasCOD: !!s?.flags?.has_cod,
  };
}

export function summarizeAddress(st) {
  const p = [];
  if (st.rua) p.push(st.rua);
  if (st.numero) p.push(`nº ${st.numero}`);
  const a = [];
  if (st.bairro) a.push(st.bairro);
  if (st.cidade && st.uf) a.push(`${st.cidade}/${st.uf}`);
  const linha1 = p.join(", ");
  const linha2 = a.join(" – ");
  const comp = st.complemento ? ` (${st.complemento})` : "";
  return `${linha1}${comp}${linha2 ? " – " + linha2 : ""} ${st.cep ? " • CEP " + st.cep : ""}`.trim();
}

/** Compat helpers já existentes */
export function listingConsent(state = {}) { return !!state?.consent_checkout; }
export function isAwaitingConsent(state = {}) { return !listingConsent(state); }
export const isAwatingConsent = isAwaitingConsent;
export const isAwaitingCheckout = isAwaitingConsent;

/** 🔎 NOVO: carimbo da origem, controlado por flags.debug_trace_replies */
export function tagReply(settings = {}, text = "", origin = "") {
  const on = settings?.flags?.debug_trace_replies === true;
  if (!on || !origin) return String(text || "");
  return `${String(text || "")} (${origin})`;
}
