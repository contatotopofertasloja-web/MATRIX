// configs/bots/claudia/flow/_state.js
// Estado curto + helpers: saudação carinhosa, números fixos, resumo de endereço e carimbo (flow/*)

export function initialState() {
  return {
    // identificação & qualificação
    nome: null,
    apelido: null,
    hair_type: null,          // liso | ondulado | cacheado | crespo
    had_prog_before: null,    // boolean | null
    goal: null,               // "liso" | "alinhado" | "reduzir frizz"...
    // intenções rápidas
    price_allowed: false,
    link_allowed: false,
    consent_checkout: false,
    // rastros
    turns: 0,
    stage: "recepcao",
    last_intent: null,
    // fechamento
    telefone: null,
    cep: null,
    rua: null,
    numero: null,
    complemento: null,
    bairro: null,
    cidade: null,
    uf: null,
    referencia: null,
    // anti-loop
    __sent_opening_photo: false,
    last_offer_at: 0,
    last_link_at: 0,
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
  const empresa = (s.company && s.company.name) || "TopOfertas";
  const hours = (s.company && s.company.hours) || "06:00–21:00";
  const product = s.product || {};

  const priceOriginal = numEnv("PRICE_ORIGINAL", product.price_original ?? 197);
  const priceTarget   = numEnv("PRICE_TARGET",   product.price_target   ?? 170);

  return {
    empresa,
    hours,
    priceOriginal,
    priceTarget,
    applications: product.applications_up_to ? `até ${product.applications_up_to} aplicações` : "várias aplicações",
    duration: product.duration_avg || "de 2 a 3 meses",
    soldCount: s?.marketing?.sold_count || 40000,
    hasCOD: !!s?.flags?.has_cod,
  };
}

export function summarizeAddress(st = {}) {
  const p1 = [];
  if (st.rua) p1.push(st.rua);
  if (st.numero) p1.push(`nº ${st.numero}`);
  const p2 = [];
  if (st.bairro) p2.push(st.bairro);
  if (st.cidade && st.uf) p2.push(`${st.cidade}/${st.uf}`);
  const comp = st.complemento ? ` (${st.complemento})` : "";
  const linha1 = p1.join(", ");
  const linha2 = p2.join(" – ");
  return [linha1 + comp, linha2].filter(Boolean).join(" – ");
}

export function isAwaitingConsent(state = {}) {
  return state && state.consent_checkout === true;
}

/** Carimba a saída com (flow/<tag>) e aplica guardrails leves */
export function tagReply(settings = {}, text = "", tag = "flow") {
  const allow = new Set(
    (settings?.guardrails?.allowed_links || [])
      .map(String)
      .filter((u) => /^https?:\/\//i.test(u))
  );
  const safe = String(text || "").replace(/https?:\/\/\S+/gi, (u) => (allow.has(u) ? u : "[link removido]"));
  return `${safe} (${tag})`;
}
