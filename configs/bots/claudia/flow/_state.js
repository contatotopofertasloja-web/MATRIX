// configs/bots/claudia/flow/_state.js

// --- Estado inicial (mantido e ampliado) ------------------------------
export function initialState() {
  return {
    // perfil
    nome: null,
    apelido: null,
    tipo_cabelo: null,       // ← usado pelos flows atuais
    objetivo: null,

    // flags de conversa
    asked_price_once: false,
    asked_name_once: false,
    asked_hair_once: false,
    consent_checkout: false, // usado por listingConsent/isAwaitingConsent
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

    // vendas (cooldowns/flags internas)
    _sales: { last_offer_at: 0, last_link_at: 0, link_allowed: false },
    // aux para carinhos
    _apx: 0,
  };
}

const CARINHOS = ["minha linda", "amor", "gata", "minha flor"];

// Grava nome quando o usuário se apresenta (robusto a variações)
export function setNameFromText(state = {}, text = "") {
  const s = String(text || "");
  const m =
    s.match(/\b(?:meu\s+nome\s+é|eu\s+sou\s+o|eu\s+sou\s+a|eu\s+me\s+chamo|pode\s*me\s*chamar\s*de|me\s*chame\s*de)\s+([A-Za-zÀ-ú' ]{2,})/i);
  if (m && m[1]) {
    const nome = m[1].trim().replace(/\s+/g, " ");
    if (nome && nome.length <= 40) state.nome = capitalize(nome.split(" ")[0]);
  }
}

// Nome amigável para chamar o usuário
export function callUser(state = {}) {
  const n = (state?.nome || "").trim();
  if (n) return n.split(" ")[0];
  const ap = CARINHOS[(state._apx || 0) % CARINHOS.length];
  state._apx = (state._apx || 0) + 1;
  return ap;
}

const CAP = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
export const capitalize = (s) => String(s || "").split(" ").map(CAP).join(" ");

// Números vindos de ENV (mantido)
function numEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const n = Number(String(raw).replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

// Lê dados fixos do settings (compat com formatos antigos e atuais)
export function getFixed(settings = {}) {
  const s = settings || {};
  const empresa =
    s?.company?.name || s.company_name || "TopOfertas";
  const hora =
    s?.company?.hours ||
    `${s?.business?.hours_start || "06:00"}–${s?.business?.hours_end || "21:00"}`;

  const sorteioOn =
    !!s?.sweepstakes?.enabled || !!s?.promotions?.raffle?.enabled;

  const sorteioTeaser =
    (s?.sweepstakes?.messages?.teaser || [])[0] ||
    s?.promotions?.raffle?.teaser ||
    "Atualmente, não temos sorteios ativos.";

  const product = s.product || {};
  const priceOriginal = numEnv("PRICE_ORIGINAL", product.price_original ?? 197);
  const priceTarget   = numEnv("PRICE_TARGET",   product.price_target   ?? 170);

  const applications =
    product.applications_up_to ??
    product.applications_range ??
    "até 10 aplicações";

  const duration =
    product.duration_avg || "em média 3 meses";

  const checkout_link = String(product.checkout_link || "");

  return {
    empresa,
    hora,
    sorteioOn,
    sorteioTeaser,
    priceOriginal,
    priceTarget,
    applications,
    duration,
    soldCount: s?.marketing?.sold_count || 40000,
    hasCOD: !!s?.flags?.has_cod,
    checkout_link,
  };
}

// Resumo de endereço (mantido)
export function summarizeAddress(st = {}) {
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

// Consentimento para listar/mostrar checkout/link
export function listingConsent(state = {}) { return !!state?.consent_checkout; }
export function isAwaitingConsent(state = {}) { return !listingConsent(state); }
// Aliases de compat
export const isAwatingConsent = isAwaitingConsent;
export const isAwaitingCheckout = isAwaitingConsent;
