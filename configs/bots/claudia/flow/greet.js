// configs/bots/claudia/flow/greet.js
// Correções aplicadas (base: 2009 - greet.txt):
// 1) Flags persistentes (askedName / askedKnown) + compat. com asked volátil.
// 2) Interpreta "sim/não" ANTES de re-perguntar se conhece (evita loop).
// 3) "não conheço" → envia DUAS mensagens (explicação breve + ask_goal).
// 4) "já conheço" → vai direto para offer.ask_cep_city.
// 5) Carimbos (tags) preservados para rastreio em produção.

import { ensureProfile, ensureAsked, markAsked, tagReply } from "./_state.js";
import { remember, recall } from "../../../../src/core/memory.js";

const T = (s = "") => String(s).normalize("NFC");
const toTitle = (s = "") => (s ? s[0].toLocaleUpperCase("pt-BR") + s.slice(1) : s);

// ——— detecta objetivo no texto livre ———
function detectGoal(s = "") {
  const t = T(s).toLowerCase();
  if (/\balis(ar|amento)|liso|progressiva\b/.test(t)) return "alisar";
  if (/\bfrizz|arrepiad/.test(t)) return "frizz";
  if (/\b(baixar|reduzir|diminuir)\s+volume\b|\bvolume\b/.test(t)) return "volume";
  if (/\bbrilho|brilhos[oa]|iluminar\b/.test(t)) return "brilho";
  return null;
}

// ——— tenta extrair nome do texto livre ———
function pickNameFromFreeText(s = "") {
  const t = T(s).trim();
  const m = t.match(/\b(meu\s*nome\s*é|me\s*chamo|sou)\s+([\p{L}’'\-]{2,}(?:\s+[\p{L}’'\-]{2,})*)/iu);
  if (m) return m[2].trim();

  // se não for "sim/não/conheço", aceita a primeira palavra como possível nome
  const block = /\b(n(ã|a)o|sim|já|ja|conhe[cç]o)\b/i;
  if (!block.test(t)) {
    const m2 = t.match(/^\s*([\p{L}’'\-]{2,})/u);
    if (m2) return m2[1];
  }
  return "";
}

// ——— vocativo suave ———
function pickVocative(profile) {
  const first = (profile?.name || "").split(" ")[0] || "";
  const r = Math.random();
  if (first && r < 0.55) return first;
  if (r < 0.75) return "minha flor";
  if (r < 0.90) return "amiga";
  return "";
}
const vocStr = (voc) => (voc ? `, ${voc}` : "");

// ——— fluxo greet ———
export default async function greet(ctx = {}) {
  const { jid = "", state = {}, text = "" } = ctx;
  const profile = ensureProfile(state);
  const askedVolatile = ensureAsked(state); // compat. com core atual
  const s = T(text).trim();

  // ——— carrega memória persistida (profile + flags) ———
  let flags = { askedName: false, askedKnown: false };
  try {
    const saved = await recall(jid);
    if (saved?.profile) Object.assign(profile, saved.profile);
    if (saved?.flags) flags = { ...flags, ...saved.flags };
  } catch {}

  const save = async () => {
    try { await remember(jid, { profile, flags }); } catch {}
  };

  // 0) objetivo pode ser declarado a qualquer momento → ir para offer
  const g0 = detectGoal(s);
  if (g0) {
    profile.goal = g0;
    state.stage = "offer.ask_cep_city";
    await save();
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

  // 1) coletar nome
  if (!profile.name) {
    // se já perguntamos (flag persistente ou volátil), tentar extrair
    if (flags.askedName || askedVolatile.name) {
      const picked = toTitle(pickNameFromFreeText(s));
      if (picked) {
        profile.name = picked;
        flags.askedName = true;
        markAsked(state, "name");
        await save();
      } else {
        return {
          reply: tagReply(ctx, "Pode me dizer seu nome? Ex.: Ana, Bruno, Andréia…", "flow/greet#ask_name"),
          meta: { tag: "flow/greet#ask_name" },
        };
      }
    } else {
      flags.askedName = true;
      markAsked(state, "name");
      await save();
      return {
        reply: tagReply(ctx, "Oi! Eu sou a Cláudia 💚 Como posso te chamar?", "flow/greet#ask_name"),
        meta: { tag: "flow/greet#ask_name" },
      };
    }
  }

  // 2) interpretar resposta à pergunta "já conhece?"
  const saysNo  = /\bn(ã|a)o(\s*conhe[cç]o)?\b/i.test(s);
  const saysYes = /\b(sim|já|ja|conhe[cç]o|usei)\b/i.test(s);

  if (saysNo) {
    flags.askedKnown = true;
    await save();
    const voc = pickVocative(profile);
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
    return { replies: [msg1, msg2], meta: { tag: "flow/greet#ask_goal" } };
  }

  if (saysYes) {
    flags.askedKnown = true;
    state.stage = "offer.ask_cep_city";
    await save();
    const voc = pickVocative(profile);
    return {
      reply: tagReply(
        ctx,
        `Ótimo${vocStr(voc)}! Posso consultar se há **oferta especial para o seu endereço**. Me envia **Cidade + CEP** (ex.: 01001-000 – São Paulo/SP).`,
        "flow/greet#known_yes→offer"
      ),
      meta: { tag: "flow/greet#known_yes→offer" },
    };
  }

  // 3) se ainda não perguntamos, perguntar se conhece
  if (!flags.askedKnown && !askedVolatile.known) {
    flags.askedKnown = true;
    markAsked(state, "known");
    await save();
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

  // 4) fallback: reforçar objetivo caso a resposta não encaixe
  const voc = pickVocative(profile);
  return {
    reply: tagReply(
      ctx,
      `Certo${vocStr(voc)}! Qual é o seu objetivo hoje: **alisar, reduzir frizz, baixar volume** ou **dar brilho**?`,
      "flow/greet#ask_goal"
    ),
  };
}
