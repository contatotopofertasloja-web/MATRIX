// configs/bots/claudia/flow/greet.js
// Saudação inicial: apresenta Cláudia, empresa, produto e coleta o nome.
// Usa foto de abertura (1x), guarda nome no state.profile e evita loops.

import { tagReply } from "./_state.js";

function guessNameFromText(t) {
  if (!t) return null;
  const s = String(t || "").trim();
  const m = s.match(/\b(meu\s+nome\s+é|me\s+chamo|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][^\d,.;!?]{2,30})/i);
  if (m?.[2]) return m[2].trim();
  const w = s.match(/\b([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,})\b/);
  return w?.[1] || null;
}

export default async function greet(ctx) {
  const { settings, outbox, jid, state, text } = ctx;
  state.turns = (state.turns || 0) + 1;
  state.profile = state.profile || {};

  // 1) Foto de abertura
  if (settings?.flags?.send_opening_photo && settings?.media?.opening_photo_url && !state.__sent_opening_photo) {
    await outbox.publish({
      to: jid,
      kind: "image",
      payload: { url: settings.media.opening_photo_url, caption: "" },
    });
    state.__sent_opening_photo = true;
  }

  // 2) Guarda nome se detectado
  const maybeName = guessNameFromText(text);
  if (maybeName) state.profile.name = maybeName;

  // 3) Saudação principal
  const loja = settings?.product?.store_name || "TopOfertas";
  const produto = settings?.product?.name || "nosso produto";

  if (!state.profile.name) {
    return `Oi, eu sou a Cláudia da *${loja}* 😊. Sou especialista na *${produto}*. Qual é o seu nome? (flow/greet)`;
  }

  return `Oi *${state.profile.name}*! Fico feliz em falar com você 💕. Quer que eu te conte mais sobre a *${produto}*? (flow/greet)`;
}
