// configs/bots/claudia/flow/greet.js
// Base preservada (1900). Correções:
// 1) Persistência de profile via memory (recall/remember) para não perder nome/objetivo entre turnos.
// 2) “não conheço” → duas mensagens (replies[]).
// 3) “já conheço” → cai direto em offer.ask_cep_city.
// Carimbos e vocativos preservados.

import { ensureProfile, ensureAsked, markAsked, tagReply } from "./_state.js";
import { remember, recall } from "../../../../src/core/memory.js";

// ————————— util unicode —————————
const T = (s = "") => String(s).normalize("NFC");
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

// ————————— nome livre —————————
function pickNameFromFreeText(s = "") {
  const t = T(s).trim();
  const m = t.match(/\b(meu\s*nome\s*é|me\s*chamo|sou)\s+([\p{L}’'\-]{2,}(?:\s+[\p{L}’'\-]{2,})*)/iu);
  if (m) return m[2].trim();

  const block = /\b(n(ã|a)o|sim|já|ja|conhe[cç]o)\b/i;
  if (!block.test(t)) {
    const m2 = t.match(/^\s*([\p{L}’'\-]{2,})/u);
    if (m2) return m2[1];
  }
  return "";
}

// ————————— vocativo —————————
function pickVocative(profile) {
  const first = (profile?.name || "").split(" ")[0] || "";
  const r = Math.random();
  if (first && r < 0.55) return first;
  if (r < 0.75) return "minha flor";
  if (r < 0.90) return "amiga";
  return "";
}
const vocStr = (voc) => (voc ? `, ${voc}` : "");

export default async function greet(ctx = {}) {
  const { jid = "", state = {}, text = "" } = ctx;
  const profile = ensureProfile(state);
  const asked = ensureAsked(state);
  const s = T(text).trim();

  // ——— carrega profile persistido (evita voltar a pedir nome) ———
  try {
    const saved = await recall(jid);
    if (saved?.profile) Object.assign(profile, saved.profile);
  } catch {}

  // 0) objetivo declarado em qualquer momento → handoff p/ offer
  const g0 = detectGoal(s);
  if (g0) {
    profile.goal = g0;
    state.stage = "offer.ask_cep_city";
    try { await remember(jid, { profile }); } catch {}
    const voc = pickVocative(profile);
    return {
      reply: tagReply(
        ctx,
        `Perfeito${vocStr(voc)}! Pra liberar a condição do dia, me passe o CEP (ex.: 00000-000) e a cidade (ex.: Brasília/DF).`,
        "flow/greet→offer"
      ),
      meta: { tag: "flow/greet→offer" },
    };
  }

  // 1) ainda não temos nome? pedir nome
  if (!profile.name) {
    if (asked.name) {
      const picked = toTitle(pickNameFromFreeText(s));
      if (picked) {
        profile.name = picked;
        try { await remember(jid, { profile }); } catch {}
        markAsked(state, "name");

        const saysNo = /\bn(ã|a)o(\s+conhe[cç]o)?\b/i.test(s);
        const saysYes = /\b(sim|já\s*conhe[cç]o|conhe[cç]o)\b/i.test(s);
        if (saysNo || saysYes) {
          const voc = pickVocative(profile);
          return {
            reply: tagReply(
              ctx,
              `Prazer${vocStr(voc)}! Qual é o seu objetivo hoje: alisar, reduzir frizz, baixar volume ou dar brilho?`,
              "flow/greet#ask_goal"
            ),
            meta: { tag: "flow/greet#ask_goal" },
          };
        }

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

      return {
        reply: tagReply(ctx, "Pode me dizer seu nome? Ex.: Ana, Bruno, Andréia…", "flow/greet#ask_name"),
        meta: { tag: "flow/greet#ask_name" },
      };
    }

    markAsked(state, "name");
    return {
      reply: tagReply(ctx, "Oi! Eu sou a Cláudia 💚 Como posso te chamar?", "flow/greet#ask_name"),
      meta: { tag: "flow/greet#ask_name" },
    };
  }

  // 2) já temos nome mas ainda não perguntamos se conhece
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

  // 3) interpretar resposta “conhece?”
  const voc = pickVocative(profile);

  // ——— “não conheço” → duas mensagens (replies[]) ———
  if (/\bn(ã|a)o(\s+conhe[cç]o)?\b/i.test(s)) {
    const msg1 = tagReply(
      ctx,
      `Sem problema${vocStr(voc)}! A Progressiva Vegetal é **100% sem formol**, aprovada pela **Anvisa** e indicada para **todos os tipos de cabelo**. Ela hidrata profundamente enquanto alinha os fios ✨`,
      "flow/greet#brief_explain"
    );
    const msg2 = tagReply(
      ctx,
      `E me conta: qual é o **seu objetivo hoje**? **Alisar, reduzir frizz, baixar volume ou dar brilho**?`,
      "flow/greet#ask_goal"
    );

    return {
      replies: [msg1, msg2],
      meta: { tag: "flow/greet#ask_goal" },
    };
  }

  // ——— “já conheço” → cai direto em offer.ask_cep_city ———
  if (/\b(sim|já|conhe[cç]o|usei)\b/i.test(s)) {
    state.stage = "offer.ask_cep_city";
    try { await remember(jid, { profile }); } catch {}
    return {
      reply: tagReply(
        ctx,
        `Ótimo${vocStr(voc)}! Posso consultar se há **oferta especial para o seu endereço**. Me envia **Cidade + CEP** (ex.: 01001-000 – São Paulo/SP).`,
        "flow/greet#known_yes→offer"
      ),
      meta: { tag: "flow/greet#known_yes→offer" },
    };
  }

  // 4) fallback: reforça objetivo
  return {
    reply: tagReply(
      ctx,
      `Certo${vocStr(voc)}! Qual é o seu objetivo hoje: **alisar, reduzir frizz, baixar volume** ou **dar brilho**?`,
      "flow/greet#ask_goal"
    ),
    meta: { tag: "flow/greet#ask_goal" },
  };
}
