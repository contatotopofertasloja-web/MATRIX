// configs/bots/claudia/flow/greet.js
// Mantém conversa validada; corrige “pulo do objetivo”.
// — Não toca em offer.js —
// Carimbos preservados: [flow/greet#ask_name], [flow/greet#ask_known], [flow/greet#ask_goal], [flow/greet→offer]

import { ensureProfile, tagReply } from "./_state.js";

const T = (s="") => String(s).normalize("NFC").trim();

// Detecção simples do objetivo (mesmo vocabulário que você já vem usando)
function detectGoals(s="") {
  const t = T(s).toLowerCase();
  const goals = [];
  if (/\balis(ar|amento)|\bliso\b/.test(t)) goals.push("alisar");
  if (/\bfrizz|arrepiad/.test(t)) goals.push("frizz");
  if (/\b(baixar|reduzir|diminuir)\s+volume|\bvolume\b/.test(t)) goals.push("volume");
  if (/\bbrilho|iluminar\b/.test(t)) goals.push("brilho");
  return [...new Set(goals)];
}

export default async function greet(ctx = {}) {
  const { state = {}, text = "" } = ctx;
  const s = T(text);
  const profile = ensureProfile(state);

  // 0) Nome (mantém seu comportamento: “meu nome é…”, “me chamo…”, etc.)
  if (!profile.name) {
    // Se já perguntamos e a pessoa respondeu, tenta extrair
    const m = s.match(/\b(meu\s*nome\s*é|me\s*chamo|sou)\s+(.{2,})$/i);
    if (m) profile.name = T(m[2]).replace(/\s+/g, " ").trim();

    if (!profile.name) {
      return {
        reply: tagReply(ctx, "Oi! Eu sou a Cláudia 💚 Como posso te chamar?", "flow/greet#ask_name")
      };
    }
  }

  // 1) Pergunta “já conhece?”
  if (!state._askedKnown) {
    state._askedKnown = true;
    const first = profile.name.split(" ")[0];
    return {
      reply: tagReply(ctx, `Prazer, ${first}! Você já conhece a nossa Progressiva Vegetal, 100% livre de formol?`, "flow/greet#ask_known")
    };
  }

  // 2) Se respondeu “sim/não”, caímos na pergunta do objetivo (não pulamos)
  if (/\b(sim|já|conhe[cç]o)\b/i.test(s) || /\bn(ã|a)o\b/i.test(s)) {
    return {
      reply: tagReply(
        ctx,
        "Qual é o seu objetivo hoje: **alisar, reduzir frizz, baixar volume ou dar brilho**?",
        "flow/greet#ask_goal"
      )
    };
  }

  // 3) Objetivo pode vir a qualquer momento
  const goals = detectGoals(s);
  if (goals.length) {
    profile.goal = goals.join("+");
    // Agora sim liberamos a etapa seguinte: pedir CEP/Cidade
    state.stage = "offer.ask_cep_city";
    return {
      reply: tagReply(
        ctx,
        "Perfeito! Pra liberar a condição do dia, me passe **CEP** (ex.: 00000-000) e **Cidade/UF** (ex.: Brasília/DF).",
        "flow/greet→offer"
      )
    };
  }

  // 4) Reforço gentil se a pessoa ainda não disse o objetivo
  return {
    reply: tagReply(
      ctx,
      "Só pra direcionar certinho: seu objetivo é **alisar, reduzir frizz, baixar volume** ou **dar brilho**?",
      "flow/greet#ask_goal"
    )
  };
}
