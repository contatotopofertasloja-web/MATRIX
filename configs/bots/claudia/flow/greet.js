// configs/bots/claudia/flow/greet.js
// Saudação com foto (1x), captura de nome e pergunta objetiva inicial.

import { remember, recall, ensureProfile, tagReply, normalizeSettings } from "./_state.js";

function guessName(t = "") {
  const s = String(t).trim();
  const m = s.match(/\b(meu\s*nome\s*é|me\s*chamo|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,})/i);
  if (m?.[2]) return m[2].trim();
  const solo = s.match(/^\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,})\s*$/);
  return solo?.[1] || "";
}

export default async function greet(ctx) {
  const { jid, outbox, state, text, settings } = ctx;
  const S = normalizeSettings(settings);
  state.turns = (state.turns || 0) + 1;
  ensureProfile(state);

  // Envia foto 1x
  if (S.flags.send_opening_photo && S.media.opening_photo_url && !state.__sent_opening_photo) {
    await outbox.publish({ to: jid, kind: "image", payload: { url: S.media.opening_photo_url, caption: "" } });
    state.__sent_opening_photo = true;
  }

  // Nome (se vier junto)
  const maybe = guessName(text);
  if (maybe) {
    state.profile.name = maybe;
    await remember(jid, { profile: state.profile });
  } else {
    // tenta recuperar de memória
    const saved = await recall(jid);
    if (saved?.profile?.name && !state.profile.name) state.profile.name = saved.profile.name;
  }

  const name = state.profile.name ? `, ${state.profile.name}` : "";
  const opening =
    S.messages?.opening?.[0] ||
    `Oi${name}! Eu sou a Cláudia da *${S.product.store_name}*. Pra te orientar certinho: seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?`;

  return tagReply(S, opening, "flow/greet");
}
