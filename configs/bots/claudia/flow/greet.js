// configs/bots/claudia/flow/greet.js
// Merge 1311 (estável) + 2 mensagens no “não conheço” + carimbo anticolisão.
// - Encadeamento nome → conhece? → objetivo (do 1311)
// - “não conheço” => 2 bolhas: explicação breve + pergunta de objetivo
// - Carimbo da pergunta de objetivo trocado para: flow/greet#objective_prompt_24k (sem “ask_goal”)
// - Objetivo em qualquer momento => handoff para offer com R$197 → R$170 → consulta especial (pré-CEP)

import { ensureProfile, ensureAsked, markAsked, tagReply } from "./_state.js";

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

// ——— nome via texto livre ———
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
  const { state = {}, text = "" } = ctx;
  const profile = ensureProfile(state);
  const asked = ensureAsked(state);
  const s = T(text).trim();

  // 0) objetivo pode aparecer a qualquer momento → ir pro offer com pré-CEP (197 → 170)
  const g0 = detectGoal(s);
  if (g0) {
    profile.goal = g0;
    state.stage = "offer.ask_cep_city";
    const voc = pickVocative(profile);
    return {
      reply: tagReply(
        ctx,
        `Perfeito${vocStr(voc)}! Hoje a nossa condição está assim:\n` +
          `💰 *Preço cheio: R$197*\n🎁 *Promo do dia: R$170*\n\n` +
          `Quer que eu *consulte no sistema* se existe *promoção especial* pro seu endereço?\n` +
          `Se sim, me envia *Cidade/UF + CEP* (ex.: *São Paulo/SP – 01001-000*).`,
        "flow/offer#precheck_special"
      ),
      meta: { tag: "flow/offer#precheck_special" },
    };
  }

  // 1) pedir nome (1º passo)
  if (!profile.name) {
    if (asked.name) {
      const picked = toTitle(pickNameFromFreeText(s));
      if (picked) {
        profile.name = picked;
        markAsked(state, "name");

        // Se na mesma frase já disser que conhece/não conhece, pula pro objetivo
        const saysNo = /\bn(ã|a)o(\s+conhe[cç]o)?\b/i.test(s);
        const saysYes = /\b(sim|já\s*conhe[cç]o|conhe[cç]o)\b/i.test(s);
        if (saysNo || saysYes) {
          const voc = pickVocative(profile);
          return {
            reply: tagReply(
              ctx,
              `Prazer${vocStr(voc)}! Qual é o seu objetivo hoje: *alisar, reduzir frizz, baixar volume* ou *dar brilho*?`,
              "flow/greet#objective_prompt_24k"
            ),
            meta: { tag: "flow/greet#objective_prompt_24k" },
          };
        }

        // 2º passo: perguntar se conhece
        markAsked(state, "known");
        return {
          reply: tagReply(
            ctx,
            `Prazer, ${picked}! Você já conhece a nossa Progressiva Vegetal, *100% livre de formol*?`,
            "flow/greet#ask_known"
          ),
          meta: { tag: "flow/greet#ask_known" },
        };
      }
      // reforço de nome
      return {
        reply: tagReply(ctx, "Pode me dizer seu nome? Ex.: Ana, Bruno, Andréia…", "flow/greet#ask_name"),
        meta: { tag: "flow/greet#ask_name" },
      };
    }

    // primeira vez pedindo nome
    markAsked(state, "name");
    return {
      reply: tagReply(ctx, "Oi! Eu sou a Cláudia 💚 Como posso te chamar?", "flow/greet#ask_name"),
      meta: { tag: "flow/greet#ask_name" },
    };
  }

  // 2) se ainda não perguntamos “conhece?”, perguntar agora
  if (!asked.known) {
    markAsked(state, "known");
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

  // ——— NÃO conhece → 2 mensagens (explicação + objetivo) ———
  if (/\bn(ã|a)o(\s+conhe[cç]o)?\b/i.test(s)) {
    const msg1 = tagReply(
      ctx,
      `Sem problema${vocStr(voc)}! A Progressiva Vegetal é *100% sem formol*, aprovada pela *Anvisa* e indicada para *todos os tipos de cabelo*. Ela hidrata enquanto alinha os fios ✨`,
      "flow/greet#brief_explain"
    );
    const msg2 = tagReply(
      ctx,
      `E me conta: qual é o *seu objetivo hoje*? *Alisar, reduzir frizz, baixar volume ou dar brilho*?`,
      "flow/greet#objective_prompt_24k"
    );
    return { replies: [msg1, msg2], meta: { tag: "flow/greet#objective_prompt_24k" } };
  }

  // ——— SIM, já conhece → pergunta de objetivo (1 mensagem) ———
  if (/\b(sim|já|conhe[cç]o|usei)\b/i.test(s)) {
    return {
      reply: tagReply(
        ctx,
        `Ótimo${vocStr(voc)}! Me conta: qual é o *seu objetivo hoje* — *alisar, reduzir frizz, baixar volume* ou *dar brilho*?`,
        "flow/greet#objective_prompt_24k"
      ),
      meta: { tag: "flow/greet#objective_prompt_24k" },
    };
  }

  // 4) nudge padrão se não encaixar
  return {
    reply: tagReply(
      ctx,
      `Certo${vocStr(voc)}! Qual é o seu objetivo hoje: *alisar, reduzir frizz, baixar volume* ou *dar brilho*?`,
      "flow/greet#objective_prompt_24k"
    ),
    meta: { tag: "flow/greet#objective_prompt_24k" },
  };
}
