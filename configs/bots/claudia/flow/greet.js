// configs/bots/claudia/flow/greet.js
// Abertura em 2 passos (nome → conhece?), vocativo variado e
// handoff para offer quando a cliente declara o objetivo.
// Correção: extração de nome com Unicode (NFC + \p{L}) para não truncar acentos.
// Carimbos preservados. Formatação enxuta.

import { ensureProfile, ensureAsked, markAsked, tagReply } from "./_state.js";

// ————————— util unicode —————————
const T = (s = "") => String(s).normalize("NFC"); // normaliza para NFC (ex.: "é" → "é")
const toTitle = (s = "") => (s ? s[0].toLocaleUpperCase("pt-BR") + s.slice(1) : s);

// ————————— detecção de objetivo —————————
function detectGoal(s = "") {
  const t = T(s).toLowerCase();
  if (/\balis(ar|amento)|liso|progressiva\b/.test(t)) return "alisar";
  if (/\bfrizz|arrepiad/.test(t)) return "frizz";
  if (/\b(baixar|reduzir|diminuir)\s+volume\b|\bvolume\b/.test(t)) return "volume";
  if (/\bbrilho|brilhos[oa]|iluminar\b/.test(t)) return "brilho";
  return null;
}

// ————————— nome livre (curto) —————————
function pickNameFromFreeText(s = "") {
  const t = T(s).trim();

  // “meu nome é … / me chamo … / sou …”  (Unicode-safe)
  const m = t.match(/\b(meu\s*nome\s*é|me\s*chamo|sou)\s+([\p{L}’'\-]{2,}(?:\s+[\p{L}’'\-]{2,})*)/iu);
  if (m) return m[2].trim();

  // resposta curta (primeira palavra) – ignora “não/sim/já/conheço…”
  const block = /\b(n(ã|a)o|sim|já|ja|conhe[cç]o)\b/i;
  if (!block.test(t)) {
    const m2 = t.match(/^\s*([\p{L}’'\-]{2,})/u);
    if (m2) return m2[1];
  }
  return "";
}

// ————————— vocativo variado —————————
function pickVocative(profile) {
  const first = (profile?.name || "").split(" ")[0] || "";
  // pesos: 55% nome, 20% “minha flor”, 15% “amiga”, 10% vazio
  const r = Math.random();
  if (first && r < 0.55) return first;
  if (r < 0.75) return "minha flor";
  if (r < 0.90) return "amiga";
  return ""; // às vezes sem vocativo, para não soar repetitiva
}
const vocStr = (voc) => (voc ? `, ${voc}` : "");

export default async function greet(ctx = {}) {
  const { state = {}, text = "" } = ctx;
  const profile = ensureProfile(state);
  const asked = ensureAsked(state);
  const s = T(text).trim();

  // 0) objetivo declarado em qualquer momento → handoff p/ offer + já pedir CEP+Cidade
  const g0 = detectGoal(s);
  if (g0) {
    profile.goal = g0;
    state.stage = "offer.ask_cep_city";
    const voc = pickVocative(profile);
    return {
      reply: tagReply(
        ctx,
        `Perfeito${vocStr(voc)}! Nossa Progressiva Vegetal serve para todos os tipos de cabelo.\n` +
          `Pra liberar a condição do dia, me passe o CEP (ex.: 00000-000) e a cidade (ex.: Brasília/DF).`,
        "flow/greet→offer"
      ),
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
        markAsked(state, "name"); // mantemos marcado

        // se na mesma frase disser que não conhece/conhece, já vamos pro objetivo
        const saysNo = /\bn(ã|a)o(\s+conhe[cç]o)?\b/i.test(s);
        const saysYes = /\b(sim|já\s*conhe[cç]o|conhe[cç]o)\b/i.test(s);
        if (saysNo || saysYes) {
          const voc = pickVocative(profile);
          return {
            reply: tagReply(
              ctx,
              `Prazer${vocStr(voc)}! Qual é o seu objetivo hoje: alisar, reduzir frizz, baixar volume ou dar brilho de salão em casa?`,
              "flow/greet#ask_goal"
            ),
            meta: { tag: "flow/greet#ask_goal" },
          };
        }

        // 2º passo: perguntar se conhece a Progressiva
        markAsked(state, "known");
        return {
          reply: tagReply(
            ctx,
            `Prazer, ${picked}! Você já conhece a nossa Progressiva Vegetal, 100% livre de formol?`,
            "flow/greet#ask_known"
          ),
          meta: { tag: "flow/greet#ask_known" },
        };
      }

      // ainda não deu pra extrair nome → reforço curto
      return {
        reply: tagReply(ctx, "Pode me dizer seu nome? Ex.: Ana, Bruno, Andréia…", "flow/greet#ask_name"),
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
      reply: tagReply(
        ctx,
        `Prazer, ${first}! Você já conhece a nossa Progressiva Vegetal, 100% livre de formol?`,
        "flow/greet#ask_known"
      ),
      meta: { tag: "flow/greet#ask_known" },
    };
  }

  // 3) interpretar resposta “conhece?” e levar para o objetivo
  const voc = pickVocative(profile);

  if (/\bn(ã|a)o(\s+conhe[cç]o)?\b/i.test(s)) {
    return {
      reply: tagReply(
        ctx,
        `Sem problema${vocStr(voc)}! Qual é o seu objetivo hoje: alisar, reduzir frizz, baixar volume ou dar brilho de salão em casa?`,
        "flow/greet#ask_goal"
      ),
      meta: { tag: "flow/greet#ask_goal" },
    };
  }
  if (/\b(sim|já|conhe[cç]o)\b/i.test(s)) {
    return {
      reply: tagReply(
        ctx,
        `Ótimo${vocStr(voc)}! Me conta: qual é o seu objetivo hoje — alisar, reduzir frizz, baixar volume ou dar brilho de salão em casa?`,
        "flow/greet#ask_goal"
      ),
      meta: { tag: "flow/greet#ask_goal" },
    };
  }

  // 4) se vier o objetivo na próxima, cai no bloco 0; senão, nudge
  return {
    reply: tagReply(
      ctx,
      `Certo${vocStr(voc)}! Qual é o seu objetivo hoje: alisar, reduzir frizz, baixar volume ou dar brilho de salão em casa?`,
      "flow/greet#ask_goal"
    ),
    meta: { tag: "flow/greet#ask_goal" },
  };
}
