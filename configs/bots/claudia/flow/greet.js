// configs/bots/claudia/flow/greet.js
// Saudação curta, envia mídia de abertura (se habilitado) e avança para qualificação.

import { callUser } from "./_state.js";

export default async function greet(ctx) {
  const { settings, outbox, jid, state } = ctx;
  state.turns = (state.turns || 0) + 1;

  // Envia a foto de abertura uma única vez por sessão (se habilitado)
  if (
    settings?.flags?.send_opening_photo &&
    settings?.media?.opening_photo_url &&
    !state.__sent_opening_photo
  ) {
    await outbox.publish({
      to: jid,
      kind: "image",
      payload: { url: settings.media.opening_photo_url, caption: "" },
    });
    state.__sent_opening_photo = true;
  }

  const opening =
    settings?.messages?.opening?.[0] ||
    "Oi! 💖 Eu sou a Cláudia. Quer me contar rapidinho como é seu cabelo (liso, ondulado, cacheado ou crespo)?";

  // Mantém tom curto + pergunta que avança o funil
  return { reply: opening, next: "qualificacao" };
}
