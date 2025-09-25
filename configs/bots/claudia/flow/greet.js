// configs/bots/claudia/flow/greet.js
// Saudação idempotente: captura nome (se vier), recupera da memória se existir
// e faz uma única pergunta de abertura. A foto de abertura é enviada pelo flow/index.js.

import { remember, recall, ensureProfile, tagReply, normalizeSettings, callUser } from "./_state.js";

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

  // 1) tenta capturar nome deste turno
  const maybe = guessName(text);
  if (maybe) {
    state.profile.name = maybe;
    try { await remember(jid, { profile: state.profile }); } catch {}
  } else {
    // 2) sem nome no turno → tenta recuperar da memória persistente
    try {
      const saved = await recall(jid);
      if (saved?.profile?.name && !state.profile.name) state.profile.name = saved.profile.name;
    } catch {}
  }

  const name = callUser(state);
  const hello = name ? `Oi, ${name}!` : "Oi!";
  const openingText =
    S.messages?.opening?.[0] ||
    `${hello} Eu sou a Cláudia da *${S.product.store_name}*. Pra te orientar certinho: seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?`;

  // ⚠️ Importante: a foto de abertura (se houver) é enviada pelo flow/index.js
  // via ensureOpeningPhotoOnce(). Aqui, só devolvemos a primeira fala.
  return tagReply(S, openingText, "flow/greet");
}
