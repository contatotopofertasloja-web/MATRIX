// configs/bots/claudia/flow/qualify.js
// Mantém a rota validada e impede pular o objetivo.
// — Não toca em offer.js —

import { ensureProfile, tagReply } from "./_state.js";

const T = (s="") => String(s).normalize("NFC").trim();

function detectGoals(s="") {
  const t = T(s).toLowerCase();
  const goals = [];
  if (/\balis(ar|amento)|\bliso\b/.test(t)) goals.push("alisar");
  if (/\bfrizz|arrepiad/.test(t)) goals.push("frizz");
  if (/\b(baixar|reduzir|diminuir)\s+volume|\bvolume\b/.test(t)) goals.push("volume");
  if (/\bbrilho|iluminar\b/.test(t)) goals.push("brilho");
  return [...new Set(goals)];
}

export default async function qualify(ctx = {}) {
  const { state = {}, text = "" } = ctx;
  const profile = ensureProfile(state);

  // Tenta capturar objetivos
  const goals = detectGoals(text);
  if (goals.length) {
    profile.goal = goals.join("+");
  }

  // Só avança quando tiver objetivo
  if (profile.goal) {
    state.stage = "offer.ask_cep_city";
    return {
      reply: tagReply(
        ctx,
        "Perfeito! Me envie **CEP** (ex.: 00000-000) e **Cidade/UF** (ex.: São Paulo/SP) para eu consultar a **oferta do dia** pro seu endereço.",
        "flow/qualify→offer"
      )
    };
  }

  // Repergunta — evita “pular”
  return {
    reply: tagReply(
      ctx,
      "Qual é o seu objetivo hoje?\n• **Alisar**\n• **Reduzir frizz**\n• **Baixar volume**\n• **Dar brilho**\n(Se forem dois, pode dizer os dois 😉)",
      "flow/qualify#ask_goal"
    )
  };
}
