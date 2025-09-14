// configs/bots/claudia/flow/qualify.js
// Qualificação: preenche nome, tipo de cabelo e objetivo.
// Regras: nada de preço/link aqui; tom de amiga; frases curtas; sempre avança o funil.

import { callUser } from "./_state.js";

// --- helpers simples ---
const has = (v) => v != null && String(v).trim().length > 0;

function extractName(text) {
  // pega o primeiro nome após padrões comuns
  const m =
    text.replace(/\s+/g, " ").match(/(?:meu\s+nome\s+é|me\s+chamo|sou)\s+([\p{L}.'\- ]{2,})/iu) ||
    text.match(/^\s*([\p{L}.'\-]{2,})[\s,!?.]/u);
  if (!m) return null;
  const raw = m[1].trim().replace(/[^ \p{L}.'\-]/gu, "");
  const first = raw.split(" ")[0];
  return first.length >= 2 ? first : null;
}

function extractHair(text) {
  const t = text.toLowerCase();
  if (/liso\b/.test(t)) return "liso";
  if (/ondulad/.test(t)) return "ondulado";
  if (/cachead/.test(t)) return "cacheado";
  if (/cresp/.test(t)) return "crespo";
  return null;
}

function extractGoal(text) {
  const t = text.toLowerCase();
  if (/\balisar|bem liso|chapado\b/.test(t)) return "alisar";
  if (/\breduz(ir)?\s*volume|menos volume|desarmar\b/.test(t)) return "reduzir volume";
  if (/\bfrizz|arrepiad/.test(t)) return "controlar frizz";
  if (/\bbrilho|mais brilho|acabar opaco\b/.test(t)) return "dar brilho";
  if (/\balinhar|alinhado\b/.test(t)) return "alinhar";
  return null;
}

export default async function qualify(ctx) {
  const { text = "", state } = ctx;
  state.turns = (state.turns || 0) + 1;

  // tentar preencher slots automaticamente com a fala do cliente
  if (!has(state.nome)) {
    const n = extractName(text);
    if (n) state.nome = n;
  }
  if (!has(state.tipo_cabelo)) {
    const h = extractHair(text);
    if (h) state.tipo_cabelo = h;
  }
  if (!has(state.objetivo)) {
    const g = extractGoal(text);
    if (g) state.objetivo = g;
  }

  // 1) nome
  if (!has(state.nome)) {
    state.asked_name_once = true;
    return {
      reply: `Pra te orientar certinho, me diz teu **nome**, ${callUser(state)}?`,
      next: "qualificacao",
    };
  }

  // 2) tipo de cabelo
  if (!has(state.tipo_cabelo)) {
    state.asked_hair_once = true;
    return {
      reply: `${callUser(state)}, e teu **cabelo** é mais **liso**, **ondulado**, **cacheado** ou **crespo**?`,
      next: "qualificacao",
    };
  }

  // 3) objetivo
  if (!has(state.objetivo)) {
    return {
      reply: `Show, ${callUser(state)}! Qual teu objetivo hoje: **alisar**, **reduzir volume**, **controlar frizz** ou **dar brilho**?`,
      next: "qualificacao",
    };
  }

  // Tudo preenchido → reforço curto e encaminha para oferta (sem preço)
  return {
    reply:
      `Perfeito, ${callUser(state)}! Com isso eu já te guio no melhor passo a passo. ` +
      `É um tratamento seguro e prático, com resultado bonito e durável. Bora avançar?`,
    next: "oferta",
  };
}
