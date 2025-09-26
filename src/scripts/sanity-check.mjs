// Sanity check do NLU — roda classificações rápidas em frases comuns.
// Uso: NLU_DEBUG=1 node src/scripts/sanity-check.mjs

import { classify, suggestNextStage } from "../core/nlu.js";

// (Opcional) carrega .env se você usa
try { await import("dotenv/config"); } catch {}

const SAMPLES = [
  // saudações
  "oi", "boa tarde", "olá claudia",

  // preço / oferta
  "quanto custa?", "tem promoção?", "qual o valor?",

  // link / fechar
  "me manda o link", "quero comprar", "finalizar pedido",

  // FAQ (seu faq.yaml ajuda aqui também)
  "tem parcelamento?", "qual o nome da empresa?", "até que horas atendem?", "quando chega?",

  // objeções e dúvidas
  "tá caro", "tenho alergia", "isso funciona mesmo?",

  // uso / volume
  "como aplica?", "quantas vezes rende?", "tem quantos ml?",

  // pós-venda / encerramento
  "obrigada", "valeu", "tchau"
];

function pad(str, len=18) {
  const s = String(str);
  return s.length >= len ? s.slice(0, len-1) + "…" : s.padEnd(len, " ");
}

console.log("\n=== NLU Sanity Check ===\n");
for (const phrase of SAMPLES) {
  const res = await classify(phrase);
  const next = suggestNextStage(res.intent);
  console.log(
    `> ${pad(phrase, 28)} | intent=${pad(res.intent, 16)} score=${(res.score||0).toFixed(2)} next=${next}`
  );
}
console.log("\nDica: defina NLU_DEBUG=1 para ver no console se o acerto veio de regex interna ou de gatilhos do faq.yaml.\n");
