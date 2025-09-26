// Sanity check do NLU — rodada 2 com frases extras.
// Uso (Windows CMD):
//   set NLU_DEBUG=1
//   node src/scripts/sanity-check.mjs
// Uso (PowerShell):
//   $env:NLU_DEBUG="1"; node src/scripts/sanity-check.mjs

import { classify, suggestNextStage } from "../core/nlu.js";
try { await import("dotenv/config"); } catch {}

const SAMPLES = [
  // saudações
  "oi", "boa tarde", "olá claudia",

  // preço / oferta
  "quanto custa?", "tem promoção?", "qual o valor?",

  // link / fechar
  "me manda o link", "quero comprar", "finalizar pedido",

  // FAQ (agora com gatilhos novos no faq.yaml)
  "tem parcelamento?", "qual o nome da empresa?", "até que horas atendem?",
  "quando chega?", "quanto tempo chega?",

  // objeções e dúvidas frequentes
  "tá caro", "tenho alergia", "isso funciona mesmo?",

  // uso / volume / rendimento (expandido)
  "como aplica?", "como usar", "aplicação",
  "quantas vezes rende?", "rende quantas aplicacoes", "tem quantos ml?",

  // pós-venda / encerramento
  "obrigada", "valeu", "tchau"
];

function pad(str, len = 28) {
  const s = String(str);
  return s.length >= len ? s.slice(0, len - 1) + "…" : s.padEnd(len, " ");
}

console.log("\n=== NLU Sanity Check — Round 2 ===\n");
for (const phrase of SAMPLES) {
  const res = await classify(phrase);
  const next = suggestNextStage(res.intent);
  console.log(`> ${pad(phrase)} | intent=${res.intent.padEnd(16)} score=${(res.score||0).toFixed(2)} next=${next}`);
}
console.log("\nDica: com NLU_DEBUG=1 você vê se o acerto veio de regex interna (RX) ou dos gatilhos do faq.yaml (YAML).\n");
