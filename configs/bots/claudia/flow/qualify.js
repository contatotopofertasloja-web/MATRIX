// configs/bots/claudia/flow/qualify.js
// Base preservada (1849). Ajuste: quando ainda não há objetivo, responder em duas mensagens (replies[]):
// 1) micro explicação (brief_explain) + 2) pergunta objetiva (ask_goal).
// Mantém memória ativa, Unicode e carimbos existentes.

import { ensureProfile, tagReply } from "./_state.js";
import { remember, recall } from "../../../../src/core/memory.js";

// ——— util unicode ———
const T = (s = "") => String(s).normalize("NFC");
const toTitle = (s = "") => (s ? s[0].toLocaleUpperCase("pt-BR") + s.slice(1) : s);

// ——— detecção de objetivo ———
function detectGoal(s = "") {
  const t = T(s).toLowerCase();
  if (/\balis(ar|amento)|liso|progressiva\b/.test(t)) return "alisar";
  if (/\bfrizz|arrepiad/.test(t)) return "frizz";
  if (/\b(baixar|reduzir|diminuir)\s+volume\b|\bvolume\b/.test(t)) return "volume";
  if (/\bbrilho|brilhos[oa]|iluminar\b/.test(t)) return "brilho";
  return null;
}

// ——— extração de nome ———
const RX = {
  NAME_SENTENCE:
    /\b(meu\s*nome\s*é|me\s*chamo|sou)\s+([\p{L}’'\-]{2,}(?:\s+[\p{L}’'\-]{2,})*)/iu,
};

function sanitizeNameLikeGoal(name = "") {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return "";
  const goals = new Set(["alisar", "frizz", "volume", "brilho"]);
  return goals.has(n) ? "" : name;
}

export default async function qualify(ctx = {}) {
  const { jid, state = {}, text = "" } = ctx;
  const s = T(text).trim();
  const profile = ensureProfile(state);

  // memória anterior
  const saved = await recall(jid).catch(() => null);
  if (saved?.profile) Object.assign(profile, saved.profile);

  // nome
  const m = s.match(RX.NAME_SENTENCE);
  if (m) profile.name = toTitle(m[2].trim());
  profile.name = sanitizeNameLikeGoal(profile.name);

  // objetivo
  const goal = detectGoal(s);
  if (goal) profile.goal = goal;

  await remember(jid, { profile });

  // roteia para oferta quando já tiver objetivo
  if (profile.goal) state.stage = "offer.ask_cep_city";

  const first = profile.name ? profile.name.split(" ")[0] : null;

  if (profile.name && profile.goal) {
    return {
      reply: tagReply(
        ctx,
        `Perfeito, ${first || "💚"}! Já consigo verificar a **promoção do dia**. Me envia agora **Cidade + CEP** (ex.: 01001-000 – São Paulo/SP) para eu consultar.`,
        "flow/qualify→offer"
      ),
      meta: { tag: "flow/qualify→offer" },
    };
  }

  // ——— Ajuste: ainda sem objetivo → duas mensagens (micro-explicação + pergunta)
  if (!profile.goal) {
    const explain = tagReply(
      ctx,
      "Rapidinho 💚 A Progressiva Vegetal é **100% sem formol**, aprovada pela **Anvisa** e indicada para **todos os tipos de cabelo**. Ela hidrata enquanto alinha os fios ✨",
      "flow/qualify#brief_explain"
    );
    const ask = tagReply(
      ctx,
      "E me conta: qual é o **seu objetivo hoje**?\n• **Alisar**\n• **Reduzir frizz**\n• **Baixar volume**\n• **Dar brilho** de salão em casa",
      "flow/qualify#ask_goal"
    );
    return {
      replies: [explain, ask],
      meta: { tag: "flow/qualify#ask_goal" },
    };
  }

  // fallback (mantido)
  return {
    reply: tagReply(
      ctx,
      "Ótimo! Me envia **Cidade + CEP** (ex.: 01001-000 – São Paulo/SP) que eu consulto as condições pra você.",
      "flow/qualify→offer"
    ),
    meta: { tag: "flow/qualify→offer" },
  };
}
