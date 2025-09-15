// configs/bots/claudia/flow/greet.js
import { callUser } from "./_state.js";

export default async function greet(ctx) {
  const { settings, outbox, jid, state } = ctx;
  state.turns = (state.turns || 0) + 1;

  // Foto de abertura (1x por contato)
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

  const name = callUser(state);
  const opening =
    settings?.messages?.opening?.[0] ||
    `Oi, ${name}! 💖 Eu sou a Cláudia. Posso te explicar rapidinho sobre a *Progressiva Vegetal*?`;

  return { reply: opening, next: "qualificacao" };
}
