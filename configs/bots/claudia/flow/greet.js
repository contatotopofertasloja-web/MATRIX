// configs/bots/claudia/flow/greet.js
// Fix: regressão por falta de persistência (profile/flags) no 2320.
// Reintroduz recall/remember (memória por jid), mantém 2 mensagens no "não conheço"
// e usa carimbo anticolisão para a pergunta de objetivo.
// Base analisada: 2320 - greet.txt

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

// ——— extrai nome com cuidado (evita "oi", "olá", etc.) ———
const STOPWORDS = /\b(oi|ol[aá]|bom\s*dia|boa\s*tarde|boa\s*noite|e[ai]|hello|hi)\b/i;
function pickNameFromFreeText(s = "") {
  const t = T(s).trim();
  const m = t.match(/\b(meu\s*nome\s*é|me\s*chamo|sou)\s+([\p{L}’'\-]{2,}(?:\s+[\p{L}’'\-]{2,})*)/iu);
  if (m) return m[2].trim();
  if (!STOPWORDS.test(t) && !/\b(n[ãa]o|sim|já|ja|conhe[cç]o)\b/i.test(t)) {
    const m2 = t.match(/^\s*([\p{L}’'\-]{3,})/u);
    if (m2) return m2[1];
  }
  return "";
}

// ——— vocativo ———
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
  const askedVolatile = ensureAsked(state);
  const s = T(text).trim();

  // —— memória persistente por jid ——
  let flags = { askedName: false, askedKnown: false };
  try {
    const saved = await recall(jid);
    if (saved?.profile) Object.assign(profile, saved.profile);
    if (saved?.flags) flags = { ...flags, ...saved.flags };
  } catch {}
  const save = async () => { try { await remember(jid, { profile, flags }); } catch {} };

  // 0) objetivo pode aparecer a qualquer momento → pula pra oferta pré-CEP (197 → 170)
  const g0 = detectGoal(s);
  if (g0) {
    profile.goal = g0;
    state.stage = "offer.ask_cep_city";
    await save();
    const voc = pickVocative(profile);
    const m1 = tagReply(
      ctx,
      `Perfeito${vocStr(voc)}! Hoje a nossa condição está assim:\n` +
        `💰 *Preço cheio: R$197*\n🎁 *Promo do dia: R$170*\n\n` +
        `Quer que eu *consulte no sistema* se existe *promoção especial* pro seu endereço?\n` +
        `Se sim, me envia *Cidade/UF + CEP* (ex.: *São Paulo/SP – 01001-000*).`,
      "flow/offer#precheck_special"
    );
    return { replies: [m1], meta: { tag: "flow/offer#precheck_special" } };
  }

  // 1) coletar nome (com persistência)
  if (!profile.name) {
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

  // 2) se ainda não perguntamos “conhece?”, perguntar agora (com persistência)
  if (!flags.askedKnown && !askedVolatile.known) {
    flags.askedKnown = true;
    markAsked(state, "known");
    await save();
    const first = profile.name.split(" ")[0];
    return {
      reply: tagReply(
        ctx,
        `Prazer, ${first}! Você já conhece a nossa Progressiva Vegetal, *100% livre de formol*?`,
        "flow/greet#ask_known"
      ),
      meta: { tag: "flow/greet#ask_known" },
    };
  }

  // 3) interpretar resposta do “conhece?”
  const voc = pickVocative(profile);
  const saysNo  = /\b(n(ã|a)o|nao)(\s+conhe[cç]o)?\b/i.test(s);
  const saysYes = /\b(sim|s|já|ja|conhe[cç]o|usei)\b/i.test(s);

  if (saysNo) {
    flags.askedKnown = true;
    await save();
    const msg1 = tagReply(
      ctx,
      `Sem problema${vocStr(voc)}! A Progressiva Vegetal é *100% sem formol*, aprovada pela *Anvisa* e indicada para *todos os tipos de cabelo*. Ela hidrata enquanto alinha os fios ✨`,
      "flow/greet#brief_explain"
    );
    // carimbo anticolisão (não contém "ask_goal")
    const msg2 = tagReply(
      ctx,
      `E me conta: qual é o *seu objetivo hoje*? *Alisar, reduzir frizz, baixar volume ou dar brilho*?`,
      "flow/greet#objective_prompt_24k"
    );
    return { replies: [msg1, msg2], meta: { tag: "flow/greet#objective_prompt_24k" } };
  }

  if (saysYes) {
    flags.askedKnown = true;
    state.stage = "offer.ask_cep_city";
    await save();
    return {
      reply: tagReply(
        ctx,
        `Ótimo${vocStr(voc)}! Hoje a nossa condição está assim:\n` +
          `💰 *Preço cheio: R$197*\n🎁 *Promo do dia: R$170*\n\n` +
          `Quer que eu *consulte no sistema* se existe *promoção especial* pro seu endereço?\n` +
          `Se sim, me envia *Cidade/UF + CEP* (ex.: *01001-000 – São Paulo/SP*).`,
        "flow/offer#precheck_special"
      ),
      meta: { tag: "flow/offer#precheck_special" },
    };
  }

  // 4) fallback: reforçar objetivo
  return {
    reply: tagReply(
      ctx,
      `Certo${vocStr(voc)}! Qual é o seu objetivo hoje: *alisar, reduzir frizz, baixar volume* ou *dar brilho*?`,
      "flow/greet#objective_prompt_24k"
    ),
    meta: { tag: "flow/greet#objective_prompt_24k" },
  };
}
