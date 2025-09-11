// src/core/prompts/product.js
// Mini-catálogo e helpers (recomendação retorna só 1 produto)

export const CATALOG = [
  {
    sku: "SH-ANTIFrizz-300",
    name: "Shampoo Antifrizz 300ml",
    hairTypes: ["liso", "ondulado", "cacheado"],
    concerns: ["frizz", "ressecamento leve"],
    usage: "2-3x por semana",
    note: "Limpa sem ressecar e ajuda a reduzir frizz.",
  },
  {
    sku: "MS-Definicao-250",
    name: "Máscara Definição 250g",
    hairTypes: ["ondulado", "cacheado", "crespo"],
    concerns: ["definicao", "frizz", "ressecamento"],
    usage: "1-2x por semana",
    note: "Define sem pesar e nutre profundamente.",
  },
  {
    sku: "LV-ProtecaoTermica-120",
    name: "Leave-in Proteção Térmica 120ml",
    hairTypes: ["liso", "ondulado", "cacheado", "crespo"],
    concerns: ["frizz", "termo", "quebra"],
    usage: "diário antes de secador/chapinha",
    note: "Protege do calor e controla frizz no dia a dia.",
  },
  {
    sku: "TP-Antiqueda-60caps",
    name: "Tônico Capilar Antiqueda",
    hairTypes: ["liso", "ondulado", "cacheado", "crespo"],
    concerns: ["queda", "fortalecimento"],
    usage: "diário por 60 dias",
    note: "Auxilia no fortalecimento e ajuda a reduzir a queda.",
  },
];

// Retorna apenas o melhor (top 1)
export function pickOneProduct({ hairType = "", concerns = [] } = {}) {
  const type = String(hairType || "").toLowerCase();
  const tags = new Set(concerns.map(c => String(c).toLowerCase()));

  const ranked = CATALOG
    .map(p => {
      const typeScore = p.hairTypes.includes(type) ? 1 : 0;
      const concernScore = p.concerns.reduce((acc, c) => acc + (tags.has(c) ? 1 : 0), 0);
      return { p, score: typeScore + concernScore };
    })
    .sort((a, b) => b.score - a.score);

  return ranked.length ? ranked[0].p : null;
}

export function formatRecommendation(prod) {
  if (!prod) return "";
  // 1 produto, 1 linha de motivo
  return `${prod.name} — ${prod.note} (uso: ${prod.usage})`;
}
