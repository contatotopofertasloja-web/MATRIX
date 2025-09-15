// configs/bots/claudia/flow/qualify.js
// Qualificação: coleta nome, tipo de cabelo e objetivo.
// Nada de preço/link aqui; tom de amiga; frases curtas.

import { callUser } from "./_state.js";

const has = (v) => v != null && String(v).trim().length > 0;

function extractName(text) {
  const m = text.match(/(?:meu\s+nome\s+é|me\s+chamo|sou)\s+([\p{L}.'\- ]{2,})/iu)
        || text.match(/^\s*([\p{L}.'\-]{2,})[\s,!?.]/u);
  if (!m) return null;
  return m[1].split(" ")[0];
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
  if (/alisar|chapado/.test(t)) return "alisar";
  if (/reduz(ir)?\s*volume/.test(t)) return "reduzir volume";
  if (/frizz|arrepiad/.test(t)) return "controlar frizz";
  if (/brilho|opaco/.test(t)) return "dar brilho";
  if (/alinhad/.test(t)) return "alinhar";
  return null;
}

export default async function qualify(ctx) {
  const { text = "", state } = ctx;
  state.turns = (state.turns || 0) + 1;

  if (!has(state.nome)) { const n = extractName(text); if (n) state.nome = n; }
  if (!has(state.tipo_cabelo)) { const h = extractHair(text); if (h) state.tipo_cabelo = h; }
  if (!has(state.objetivo)) { const g = extractGoal(text); if (g) state.objetivo = g; }

  if (!has(state.nome)) {
    return { reply: `Pra te orientar certinho, me diz teu **nome**?`, next: "qualificacao" };
  }
  if (!has(state.tipo_cabelo)) {
    return { reply: `${callUser(state)}, e teu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?`, next: "qualificacao" };
  }
  if (!has(state.objetivo)) {
    return { reply: `Show, ${callUser(state)}! Qual teu objetivo: **alisar**, **reduzir volume**, **controlar frizz** ou **dar brilho**?`, next: "qualificacao" };
  }

  return {
    reply: `Perfeito, ${callUser(state)}! Com isso já sei como te ajudar. É um tratamento seguro e prático. Bora avançar?`,
    next: "oferta",
  };
}
