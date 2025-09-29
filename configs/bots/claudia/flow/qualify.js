// configs/bots/claudia/flow/qualify.js
// Registra nome/objetivo e, quando tiver objetivo, ACIONA o offer (state.stage = "offer.ask_cep_city").
// Unicode-safe para nomes. Mantém carimbos. (base: sua versão anterior)

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
      reply: tagReply(ctx, `Perfeito, ${first || "💚"}! Já consigo verificar a promoção do dia 🙌`, "flow/qualify→offer"),
      meta: { tag: "flow/qualify→offer" },
    };
  }

  if (!profile.goal) {
    return {
      reply: tagReply(
        ctx,
        "Qual é o seu objetivo hoje: alisar, reduzir frizz, baixar volume ou dar brilho de salão em casa?",
        "flow/qualify#ask_goal"
      ),
      meta: { tag: "flow/qualify#ask_goal" },
    };
  }

  return {
    reply: tagReply(ctx, "Ótimo! Vou te passar as condições agora.", "flow/qualify→offer"),
    meta: { tag: "flow/qualify→offer" },
  };
}
