// configs/bots/claudia/flow/greet.js
// Preserva fluxo validado (173 linhas) — apenas corrige rota “já conheço”
// Carimbos mantidos

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

export default async function greet(ctx = {}) {
  const { state = {}, text = "" } = ctx;
  const s = T(text);
  const profile = ensureProfile(state);

  // captura nome
  if (!profile.name) {
    const m = s.match(/\b(meu\s*nome\s*é|me\s*chamo|sou)\s+(.{2,})$/i);
    if (m) profile.name = T(m[2]).replace(/\s+/g, " ").trim();

    if (!profile.name) {
      return {
        reply: tagReply(ctx, "Oi! Eu sou a Cláudia 💚 Como posso te chamar?", "flow/greet#ask_name")
      };
    }
  }

  // pergunta se conhece
  if (!state._askedKnown) {
    state._askedKnown = true;
    const first = profile.name.split(" ")[0];
    return {
      reply: tagReply(ctx, `Prazer, ${first}! Você já conhece a nossa Progressiva Vegetal, 100% livre de formol?`, "flow/greet#ask_known")
    };
  }

  // rota SIM/já conheço → ajuste aqui!
  if (/\b(sim|já|conhe[cç]o|usei)\b/i.test(s)) {
    // >>> NOVO COMPORTAMENTO <<<
    state.stage = "offer.ask_cep_city";
    return {
      reply: tagReply(
        ctx,
        "Perfeito! Posso consultar se há **oferta especial para o seu endereço**. Me envia **Cidade + CEP** (ex.: 01001-000 – São Paulo/SP).",
        "flow/greet#known_yes→offer"
      )
    };
  }

  // rota NÃO conhece → pede objetivo
  if (/\bn(ã|a)o\b/i.test(s) || /\bnunca\b/i.test(s)) {
    state.stage = "qualify.ask_goal";
    return {
      reply: tagReply(
        ctx,
        "Sem problemas! A Progressiva Vegetal é aprovada pela Anvisa e serve para todos os tipos de cabelo.\nQual é o seu objetivo hoje: **alisar, reduzir frizz, baixar volume ou dar brilho**?",
        "flow/greet#known_no→qualify"
      )
    };
  }

  // se escreveu o objetivo diretamente
  const goals = detectGoals(s);
  if (goals.length) {
    profile.goal = goals.join("+");
    state.stage = "offer.ask_cep_city";
    return {
      reply: tagReply(
        ctx,
        "Perfeito! Pra liberar a condição do dia, me passe **CEP** (ex.: 00000-000) e **Cidade/UF** (ex.: Brasília/DF).",
        "flow/greet→offer"
      )
    };
  }

  // fallback: reforça objetivo
  return {
    reply: tagReply(
      ctx,
      "Só pra direcionar certinho: seu objetivo é **alisar, reduzir frizz, baixar volume** ou **dar brilho**?",
      "flow/greet#ask_goal"
    )
  };
}
