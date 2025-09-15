// Saudação curta, envia mídia de abertura (se habilitado) e avança para qualificação.
// Evita repetir mídia na mesma sessão; tom humano e direto.

import { callUser } from "./_state.js";

export default async function greet(ctx) {
  const { settings, outbox, jid, state } = ctx;
  state.turns = (state.turns || 0) + 1;

  // Envia a foto de abertura UMA vez por sessão (se habilitado)
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

  // Abertura: nada de "assistente virtual". Curto + pergunta que puxa o funil.
  const opening =
    settings?.messages?.opening?.[0] ||
    `Oi! Eu sou a Cláudia. ${callUser(state)}, teu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?`;

  return { reply: opening, next: "qualificacao" };
}
