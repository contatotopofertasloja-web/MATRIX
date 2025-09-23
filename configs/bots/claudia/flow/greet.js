// configs/bots/claudia/flow/greet.js
// Greeting com A/B test, memória de nome e envio da foto 1x
// Compatível com pipeline atual (ctx = { settings, outbox, jid, state, text })
import { tagReply } from "./_state.js";

/** Extrai um possível nome do texto do usuário */
function guessNameFromText(t) {
  if (!t) return null;
  const s = String(t || "").trim();
  // "meu nome é X", "me chamo X", "sou a/o X"
  const m = s.match(/\b(meu\s+nome\s+é|me\s+chamo|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][^\d,.;!?]{2,30})/i);
  if (m?.[2]) return m[2].trim();
  // fallback: 1 palavra com inicial maiúscula
  const w = s.match(/\b([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,})\b/);
  return w?.[1] || null;
}

/** Pseudo-aleatório estável por JID (mantém bucket A/B por contato) */
function stableBucket(jid, buckets = ["A", "B"]) {
  const str = String(jid || "");
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return buckets[h % buckets.length];
}

/** Usa o nome de vez em quando (30–50%) */
function shouldUseName(prob = 0.35) {
  return Math.random() < prob;
}

export default async function greet(ctx) {
  const { settings, outbox, jid, state, text } = ctx;
  state.turns = (state.turns || 0) + 1;
  state.profile = state.profile || {};

  // 1) Foto de abertura (1x por contato)
  if (
    settings?.flags?.send_opening_photo &&
    settings?.media?.opening_photo_url &&
    !state.__sent_opening_photo
  ) {
    await outbox.publish({
      to: jid,
      kind: "image",
      payload: { url: settings.media.opening_photo_url, caption: "" }
    });
    state.__sent_opening_photo = true;
  }

  // 2) Captura/atualiza nome se o usuário já tiver dito algo
  const fromMsg = guessNameFromText(text);
  if (fromMsg && !state.profile.name) state.profile.name = fromMsg;

  // 3) Define bucket A/B estável por contato
  const ab = (state.ab && state.ab.greet) || stableBucket(jid, ["A", "B"]);
  state.ab = { ...(state.ab || {}), greet: ab };

  // 4) Variedades de abertura (neutras)
  const openings = {
    A: "Oi! Eu sou a Cláudia. Consigo te orientar certinho. Me diz rapidinho o tipo do seu cabelo (liso, ondulado, cacheado ou crespo)?",
    B: "Oi! Eu sou a Cláudia. Pra te ajudar melhor: seu cabelo é liso, ondulado, cacheado ou crespo?",
  };
  let opening = openings[ab];

  // 5) Usa o nome de vez em quando
  const name = state.profile?.name;
  if (name && shouldUseName(0.5)) {
    opening = opening.replace(/^Oi!/, `Oi, ${name}!`);
  }

  // 6) Responde e segue para QUALIFICAÇÃO
  return {
    reply: tagReply(settings, opening, `flow/greet#${ab}`),
    next: "qualificacao",
    meta: { ab }
  };
}
