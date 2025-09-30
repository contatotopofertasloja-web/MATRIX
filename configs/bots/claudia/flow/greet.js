// configs/bots/claudia/flow/greet.js
// Microfix: bypass de hooks na pergunta de objetivo (após “não conheço”)
// - Mantém 2 mensagens: explicação + pergunta de objetivo
// - msg2 vai “crua” (sem tagReply), exibindo o carimbo no próprio texto
// - meta.tag trocado para ID inédito (evita mapeamento de hook)

import { ensureProfile, ensureAsked, markAsked, tagReply } from "./_state.js";
import { remember, recall } from "../../../../src/core/memory.js";

const T = (s = "") => String(s).normalize("NFC");
const toTitle = (s = "") => (s ? s[0].toLocaleUpperCase("pt-BR") + s.slice(1) : s);

function detectGoal(s = "") {
  const t = T(s).toLowerCase();
  if (/\balis(ar|amento)|liso|progressiva\b/.test(t)) return "alisar";
  if (/\bfrizz|arrepiad/.test(t)) return "frizz";
  if (/\b(baixar|reduzir|diminuir)\s+volume\b|\bvolume\b/.test(t)) return "volume";
  if (/\bbrilho|brilhos[oa]|iluminar\b/.test(t)) return "brilho";
  return null;
}

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
  const askedVolatile = ensureAsked(state);
  const s = T(text).trim();

  // memória persistente
  let flags = { askedName: false, askedKnown: false };
  try {
    const saved = await recall(jid);
    if (saved?.profile) Object.assign(profile, saved.profile);
    if (saved?.flags) flags = { ...flags, ...saved.flags };
  } catch {}
  const save = async () => { try { await remember(jid, { profile, flags }); } catch {} };

  // 0) objetivo em qualquer momento → oferta pré-CEP (197 → 170)
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

  // 1) nome
  if (!profile.name) {
    if (flags.askedName || askedVolatile.name) {
      const picked = toTitle(pickNameFromFreeText(s));
      if (picked) {
        profile.name = picked;
        flags.askedName = true;
        markAsked(state, "name");
        await save();
      } else {
        return { reply: tagReply(ctx, "Pode me dizer seu nome? Ex.: Ana, Bruno, Andréia…", "flow/greet#ask_name") };
      }
    } else {
      flags.askedName = true;
      markAsked(state, "name");
      await save();
      return { reply: tagReply(ctx, "Oi! Eu sou a Cláudia 💚 Como posso te chamar?", "flow/greet#ask_name") };
    }
  }

  // 2) perguntar “conhece?”
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
      meta: { tag: "flow/greet#ask_known" }
    };
  }

  // 3) interpretar resposta “conhece?”
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

    // ⚠ Bypass de hooks: NÃO usar tagReply na pergunta do objetivo.
    // Mostramos o carimbo no próprio texto e meta.tag usa um ID inédito.
    const msg2 = {
      reply: `E me conta: qual é o *seu objetivo hoje*? *Alisar, reduzir frizz, baixar volume ou dar brilho*?\n[flow/greet#objective_prompt_bypass]`,
      meta: { tag: "flow/greet#objective_prompt_bypass" }
    };

    return { replies: [msg1, msg2], meta: { tag: "flow/greet#objective_prompt_bypass" } };
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
      meta: { tag: "flow/offer#precheck_special" }
    };
  }

  // 4) fallback: mesma estratégia de bypass (caso resposta não encaixe)
  const msgFallback = {
    reply: `Certo${vocStr(voc)}! Qual é o *seu objetivo hoje*: *alisar, reduzir frizz, baixar volume* ou *dar brilho*?\n[flow/greet#objective_prompt_bypass]`,
    meta: { tag: "flow/greet#objective_prompt_bypass" }
  };
  return msgFallback;
}
