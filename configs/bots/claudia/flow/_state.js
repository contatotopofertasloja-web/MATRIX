// Estado e helpers da Cláudia (somente nesta pasta do bot)
export function initialState() {
  return {
    // perfil
    nome: null,
    apelido: null,          // ex: "minha linda", "amor" (light, com moderação)
    tipo_cabelo: null,      // liso | ondulado | cacheado | crespo
    objetivo: null,         // alinhar | reduzir volume | frizz | brilho

    // flags de conversa
    asked_price_once: false,
    asked_name_once: false,
    asked_hair_once: false,
    consent_checkout: false,
    price_allowed: false,   // <<< gate: só libera preço se a cliente pedir (ou manualmente)
    turns: 0,               // contador simples de trocas

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
    stage: "recepcao", // recepcao -> qualificacao -> oferta -> fechamento -> posvenda
    last_intent: null,
  };
}

// lista curta, sem exagero
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
    "Todo mês tem sorteio ✨ (escova 3-em-1, progressiva e ativador capilar).";

  const product = s.product || {};
  // Preço: settings.yaml com override opcional por ENV
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
