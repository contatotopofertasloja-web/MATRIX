// configs/bots/claudia/flow/greet.js
// Abertura: pergunta nome (se faltar), reforça que serve para todos os tipos de cabelo
// e intercepta objetivos (alisar / frizz / volume / brilho), já preparando o offer.
// Carimbos preservados. Formatação sem excesso de asteriscos.

import { ensureProfile, tagReply } from "./_state.js";

// Sinaliza intenção do objetivo em linguagem natural
function detectGoal(s = "") {
  const t = String(s).toLowerCase();

  if (/\balis(ar|amento)|liso|progressiva\b/.test(t)) return "alisar";
  if (/\bfrizz|arrepiad/.test(t)) return "frizz";
  if (/\b(baixar|reduzir|diminuir)\s+volume\b|\bvolume\b/.test(t)) return "volume";
  if (/\bbrilho|brilhos[oa]|iluminar\b/.test(t)) return "brilho";

  return null;
}

// Evita “Prazer, alisar!” caso nome antigo/sujo esteja igual a um objetivo
function sanitizeNameLikeGoal(name = "") {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return "";
  const goals = new Set(["alisar", "frizz", "volume", "brilho"]);
  return goals.has(n) ? "" : name;
}

export default async function greet(ctx = {}) {
  const { state = {}, text = "" } = ctx;
  const profile = ensureProfile(state);

  // Limpa nomes residuais que na verdade eram objetivos
  profile.name = sanitizeNameLikeGoal(profile.name);

  const s = String(text).trim();

  // 1) Nome livre (não forçamos aqui; só pegamos se vier com “meu nome é…” etc.)
  const rxName = /\b(meu\s*nome\s*é|me\s*chamo|sou)\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,}(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,})*)/i;
  const m = s.match(rxName);
  if (m) profile.name = m[2].trim();

  // 2) Objetivo direto (baixar volume, reduzir frizz, brilho, alisar…)
  const goal = detectGoal(s);
  if (goal) {
    profile.goal = goal;

    // Deixa preparado para o flow de oferta (router __route prioriza "offer.")
    state.stage = "offer.ask_cep_city";

    // Mensagem ponte, sem itálico excessivo
    const call = profile.name ? profile.name.split(" ")[0] : "💚";
    return {
      reply: tagReply(
        ctx,
        `Perfeito, ${call}! Nossa Progressiva Vegetal serve para todos os tipos de cabelo. Já te passo a condição do dia 🙌`,
        "flow/greet→offer"
      ),
      meta: { tag: "flow/greet→offer" },
    };
  }

  // 3) Se ainda não temos nome, pedimos primeiro
  if (!profile.name) {
    return {
      reply: tagReply(
        ctx,
        "Oi! Eu sou a Cláudia 💚 Como posso te chamar? Você já conhece a nossa Progressiva Vegetal, 100% livre de formol?",
        "flow/greet#ask_name"
      ),
      meta: { tag: "flow/greet#ask_name" },
    };
  }

  // 4) Temos nome, falta objetivo → pergunta clara e formatada
  const first = profile.name.split(" ")[0];
  return {
    reply: tagReply(
      ctx,
      `Prazer, ${first}! A Progressiva Vegetal serve para todos os tipos de cabelo. Ela hidrata profundamente enquanto alinha: pode alisar, reduzir frizz, baixar volume ou dar brilho de salão em casa. Qual é o seu objetivo hoje?`,
      "flow/greet#ask_goal"
    ),
    meta: { tag: "flow/greet#ask_goal" },
  };
}
