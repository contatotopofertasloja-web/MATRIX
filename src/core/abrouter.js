// src/core/abrouter.js
// Core neutro: roteador A/B simples e determinístico (sticky) por identidade.
// Mantém o core plugável (girls só nas pastas configs/bots/<bot_id>).

// Hashzinho determinístico (rápido) p/ stickiness por identidade
function hash32(str = "") {
  let h = 2166136261 >>> 0; // FNV-1a seed
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // espalha mais um pouco
  h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
  return h >>> 0;
}

/**
 * Normaliza buckets [{ id: 'A', weight: 1 }, { id: 'B', weight: 1 }]
 */
function normalizeBuckets(buckets) {
  const arr = Array.isArray(buckets) && buckets.length ? buckets : [
    { id: "A", weight: 1 },
    { id: "B", weight: 1 },
  ];
  return arr
    .map(b => ({ id: String(b.id || "").trim() || "A", weight: Math.max(0, Number(b.weight) || 0) }))
    .filter(b => b.weight > 0);
}

/**
 * Seleciona variante de forma determinística por identidade (sticky).
 * @param {string} identity  ex.: phone/jid/userId/sessionId
 * @param {{id:string, weight:number}[]} buckets
 * @returns {string} id da variante (ex.: "A" | "B" | ...)
 */
export function pickVariant(identity = "", buckets = null) {
  const list = normalizeBuckets(buckets);
  if (!list.length) return "A";
  const total = list.reduce((s, b) => s + b.weight, 0);
  if (total <= 0) return list[0].id;

  // espalha o hash dentro do range total
  const hv = hash32(String(identity));
  const r  = hv % total;

  let acc = 0;
  for (const b of list) {
    acc += b.weight;
    if (r < acc) return b.id;
  }
  return list[0].id;
}

/**
 * Roteia uma etapa do funil para a variante escolhida.
 * Mantém API enxuta: orquestrador passa { stage, context, buckets }.
 * @param {object} params
 * @param {string} params.stage   etapa lógica (ex.: "offer")
 * @param {object} params.context deve conter uma identidade estável (jid/phone/userId)
 * @param {{id:string, weight:number}[]=} params.buckets
 * @param {string=} params.identityKey chave no context que contém a identidade (default: "jid" | "phone" | "userId")
 * @returns {{ variant: string, stage: string }}
 */
export function route({ stage = "", context = {}, buckets = null, identityKey } = {}) {
  const idKey = identityKey || (("jid" in context) ? "jid" :
                                ("phone" in context) ? "phone" :
                                ("userId" in context) ? "userId" :
                                null);
  const identity = idKey ? String(context[idKey] || "") : String(context.identity || "");
  const variant = pickVariant(identity, buckets);
  return { variant, stage: String(stage || "") };
}

/**
 * Registro de resultado (no-op por padrão).
 * O orquestrador pode chamar para telemetria/Thompson posteriormente.
 * @param {object} params
 * @param {string} params.identity
 * @param {string} params.variant
 * @param {string} params.metric   ex.: "conversion", "click", "reply"
 * @param {number} params.value    ex.: 0/1 ou score
 */
export function registerOutcome({ identity = "", variant = "", metric = "", value = 0 } = {}) {
  // Intencionalmente vazio neste shim.
  // Futuro: integrar com src/core/telemetry.js ou Thompson.
  if (process.env.DEBUG_ABROUTER === "true") {
    // Log leve para depuração (não quebra produção)
    console.log(`[abrouter] outcome`, { identity, variant, metric, value });
  }
}

// Default export para compat com imports antigos (default e named)
const api = { pickVariant, route, registerOutcome };
export default api;
