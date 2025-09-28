// configs/bots/claudia/flow/greet.js
// Abertura em 2 passos: 1) pedir o nome; 2) perguntar se conhece a Progressiva.
// Aceita respostas curtas como nome (ex.: “Vanda”) e trata “não conheço”/“sim”.
// Se vier objetivo (alisar / frizz / volume / brilho), já handoff para offer.
// Carimbos preservados. Formatação limpa (sem excesso de **).

import { ensureProfile, ensureAsked, markAsked, tagReply } from "./_state.js";

// ————————— detecção de objetivo —————————
function detectGoal(s = "") {
  const t = String(s).toLowerCase();
  if (/\balis(ar|amento)|liso|progressiva\b/.test(t)) return "alisar";
  if (/\bfrizz|arrepiad/.test(t)) return "frizz";
  if (/\b(baixar|reduzir|diminuir)\s+volume\b|\bvolume\b/.test(t)) return "volume";
  if (/\bbrilho|brilhos[oa]|iluminar\b/.test(t)) return "brilho";
  return null;
}

// ————————— normalização de nome —————————
function pickNameFromFreeText(s = "") {
  const t = s.trim();

  // “meu nome é … / me chamo … / sou …”
  const m = t.match(/\b(meu\s*nome\s*é|me\s*chamo|sou)\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,}(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,})*)/i);
  if (m) return m[2].trim();

  // resposta curta (primeira palavra) – ignora “não/sim/já/conheço…”
  const block = /\b(n(ã|a)o|sim|já|ja|conhe[cç]o)\b/i;
  if (!block.test(t)) {
    const m2 = t.match(/^\s*([A-Za-zÀ-ÖØ-öø-ÿ']{2,})/);
    if (m2) return m2[1];
  }
  return "";
}
const toTitle = (s="") => s ? s.charAt(0).toUpperCase()+s.slice(1) : s;

export default async function greet(ctx = {}) {
  const { state = {}, text = "" } = ctx;
  const profile = ensureProfile(state);
  const asked   = ensureAsked(state);
  const s       = String(text).trim();

  // 0) objetivo declarado em qualquer momento → handoff p/ offer
  const g0 = detectGoal(s);
  if (g0) {
    profile.goal = g0;
    state.stage = "offer.ask_cep_city";
    const call = profile.name ? profile.name.split(" ")[0] : "💚";
    return {
      reply: tagReply(ctx, `Perfeito, ${call}! Nossa Progressiva Vegetal serve para todos os tipos de cabelo. Já te passo a condição do dia 🙌`, "flow/greet→offer"),
      meta: { tag: "flow/greet→offer" },
    };
  }

  // 1) ainda não temos nome? pedir nome (1º passo)
  if (!profile.name) {
    // se já perguntamos o nome, tentar extrair da resposta curta
    if (asked.name) {
      const picked = toTitle(pickNameFromFreeText(s));
      if (picked) {
        profile.name = picked;
        markAsked(state, "name"); // já estava, mantemos marcado

        // se a mesma frase indica que “não conhece”, pula p/ pergunta de objetivo
        const saysNo  = /\bn(ã|a)o(\s+conhe[cç]o)?\b/i.test(s);
        const saysYes = /\b(sim|já\s*conhe[cç]o|conhe[cç]o)\b/i.test(s);
        if (saysNo || saysYes) {
          return {
            reply: tagReply(ctx, `Prazer, ${picked}! Qual é o seu objetivo hoje: alisar, reduzir frizz, baixar volume ou dar brilho de salão em casa?`, "flow/greet#ask_goal"),
            meta: { tag: "flow/greet#ask_goal" },
          };
        }

        // 2º passo: checar se conhece a Progressiva
        markAsked(state, "known");
        return {
          reply: tagReply(ctx, `Prazer, ${picked}! Você já conhece a nossa Progressiva Vegetal, 100% livre de formol?`, "flow/greet#ask_known"),
          meta: { tag: "flow/greet#ask_known" },
        };
      }

      // ainda não deu pra extrair nome → reforço curto
      return {
        reply: tagReply(ctx, "Pode me dizer seu nome? Ex.: Ana, Bruno, Vanda…", "flow/greet#ask_name"),
        meta: { tag: "flow/greet#ask_name" },
      };
    }

    // primeira vez pedindo o nome
    markAsked(state, "name");
    return {
      reply: tagReply(ctx, "Oi! Eu sou a Cláudia 💚 Como posso te chamar?", "flow/greet#ask_name"),
      meta: { tag: "flow/greet#ask_name" },
    };
  }

  // 2) já temos nome mas ainda não perguntamos se conhece → perguntar agora
  if (!asked.known) {
    markAsked(state, "known");
    const first = profile.name.split(" ")[0];
    return {
      reply: tagReply(ctx, `Prazer, ${first}! Você já conhece a nossa Progressiva Vegetal, 100% livre de formol?`, "flow/greet#ask_known"),
      meta: { tag: "flow/greet#ask_known" },
    };
  }

  // 3) interpretar resposta “conhece?” e levar para o objetivo
  const first = profile.name.split(" ")[0];

  if (/\bn(ã|a)o(\s+conhe[cç]o)?\b/i.test(s)) {
    return {
      reply: tagReply(ctx, `Sem problema, ${first}! Qual é o seu objetivo hoje: alisar, reduzir frizz, baixar volume ou dar brilho de salão em casa?`, "flow/greet#ask_goal"),
      meta: { tag: "flow/greet#ask_goal" },
    };
  }
  if (/\b(sim|já|conhe[cç]o)\b/i.test(s)) {
    return {
      reply: tagReply(ctx, `Ótimo, ${first}! Me conta: qual é o seu objetivo hoje — alisar, reduzir frizz, baixar volume ou dar brilho de salão em casa?`, "flow/greet#ask_goal"),
      meta: { tag: "flow/greet#ask_goal" },
    };
  }

  // 4) se vier o objetivo aqui, cai no bloco 0 na próxima mensagem; senão, nudge
  return {
    reply: tagReply(ctx, `Certo, ${first}! Qual é o seu objetivo hoje: alisar, reduzir frizz, baixar volume ou dar brilho de salão em casa?`, "flow/greet#ask_goal"),
    meta: { tag: "flow/greet#ask_goal" },
  };
}
