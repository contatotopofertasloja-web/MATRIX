// configs/bots/claudia/flow/greet.js
// Saudação idempotente com variante curta quando já sabemos o nome.
// ⚠️ A foto de abertura é enviada pelo flow/index.js (ensureOpeningPhotoOnce).

import {
  ensureProfile, tagReply, normalizeSettings,
  callUser, filledSummary
} from "./_state.js";
import { remember, recall } from "../../../../src/core/memory.js";

function guessName(t = "") {
  const s = String(t || "").trim();
  const m = s.match(/\b(meu\s*nome\s*é|me\s*chamo|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,})/i);
  if (m?.[2]) return m[2].trim();
  const solo = s.match(/^\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,})\s*$/);
  return solo?.[1] || "";
}

export default async function greet(ctx = {}) {
  const { jid, state = {}, text = "", settings = {} } = ctx;
  const S = normalizeSettings(settings);
  state.turns = (state.turns || 0) + 1;
  ensureProfile(state);

  // captura nome
  const maybe = guessName(text);
  if (maybe) {
    state.profile.name = maybe;
    try {
      await remember(jid, { profile: state.profile });
    } catch (e) {
      console.warn("[greet.remember]", e?.message);
    }
  } else {
    try {
      const saved = await recall(jid);
      if (saved?.profile?.name && !state.profile.name) {
        state.profile.name = saved.profile.name;
      }
    } catch (e) {
      console.warn("[greet.recall]", e?.message);
    }
  }

  const name = callUser(state);
  const haveAny = filledSummary(state);
  const rat = haveAny.length ? `Anotei: ${haveAny.join(" · ")}. ` : "";

  const openingNamed =
    S.messages?.opening_named?.[0] ||
    `${rat}Oi, ${name}! Pra te orientar certinho: seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?`;

  const openingGeneric =
    S.messages?.opening?.[0] ||
    `Oi! Eu sou a Cláudia da *${S.product.store_name}*. Pra te orientar certinho: seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?`;

  const reply = name ? openingNamed : openingGeneric;

  return tagReply(S, reply, "flow/greet");
}
