// Estado e helpers da Cláudia (somente nesta pasta do bot)
// Mantém core neutro, sem “cheiro” de bot no /src/core.

export function initialState() {
  return {
    // perfil
    nome: null,
    apelido: null,
    tipo_cabelo: null,
    objetivo: null,

    // flags de conversa
    asked_price_once: false,
    asked_name_once: false,
    asked_hair_once: false,
    consent_checkout: false,   // ← usado por listingConsent/isAwaitingConsent
    price_allowed: false,
    turns: 0,

    // concierge (endereço/contato)
    telefone: null,
    cep: null,
    rua: null,
    numero: null,
    complemento: null,
    bairro: null,
    cidade: null,
    uf: null,
    referencia: null,

    // etapas
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
  const sorteioTeaser = (s?.sweepstakes?.messages?.teaser || [])[0] ||
    "Atualmente, não temos sorteios ativos.";

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

/** Alguns flows usam para decidir se já podemos listar/mostrar checkout/link. */
export function listingConsent(state = {}) {
  return !!state?.consent_checkout;
}

/** Compat com flows antigos: se ainda estamos aguardando consentimento para checkout/link. */
export function isAwaitingConsent(state = {}) {
  return !listingConsent(state);
}

// Aliases de compat (inclusive com possível typo visto no log)
export const isAwatingConsent = isAwaitingConsent;   // alias com um 'i' faltando
export const isAwaitingCheckout = isAwaitingConsent; // alias semântico
