// configs/bots/claudia/flow/greet.js
// AB test (A/B) + captura/uso de nome + envio da foto 1x
import { tagReply } from "./_state.js";

/** Util: extrai um possível nome da mensagem de entrada */
function guessNameFromText(t) {
  if (!t) return null;
  const s = String(t).trim();
  // padrões simples: "me chamo X", "sou a X", "sou o X", "meu nome é X"
  const m = s.match(/\b(meu\s+nome\s+é|me\s+chamo|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][^\d,.;!?]{2,30})/i);
  if (m?.[2]) return m[2].trim();
  // fallback: palavra única com inicial maiúscula
  const w = s.match(/\b([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,})\b/);
  return w?.[1] ? w[1] : null;
}

/** Util: pega/define nome no state */
function resolveUserName(state, incomingText) {
  state.profile = state.profile || {};
  if (!state.profile.name) {
    const g = guessNameFromText(incomingText);
    if (g) state.profile.name = g;
  }
  return state.profile.name || null;
}

/** Seleciona variante A/B via meta.variant, ou por hash do jid */
function pickVariant(ctx) {
  const metaV = ctx?.meta?.variant;
  if (metaV === "A" || metaV === "B") return metaV;
  // hash simples e estável por jid
  const jid = String(ctx?.jid || "");
  let h = 0;
  for (let i = 0; i < jid.length; i++) h = ((h << 5) - h) + jid.charCodeAt(i);
  return (Math.abs(h) % 2) === 0 ? "A" : "B";
}

/** Chance de usar o nome (para variar a proximidade) */
function shouldUseName(seed = 0.5) {
  return Math.random() < seed;
}

export default async function greet(ctx) {
  const { settings, outbox, jid, state, text } = ctx;
  state.turns = (state.turns || 0) + 1;

  // 1) Foto de abertura (1x por contato)
  if (settings?.flags?.send_opening_photo && settings?.media?.opening_photo_url && !state.__sent_opening_photo) {
    await outbox.publish({
      to: jid,
      kind: "image",
      payload: { url: settings.media.opening_photo_url, caption: "" }
    });
    state.__sent_opening_photo = true;
  }

  // 2) Captura/resolve nome (se vier no primeiro texto)
  const name = resolveUserName(state, text);

  // 3) Define variante A/B
  const variant = pickVariant(ctx);

  // 4) Monta a mensagem conforme a variante
  const set = settings?.messages || {};
  let opening = "";

  if (variant === "A") {
    opening = (set.opening_A?.[0])
      || "Oi, eu sou a Cláudia da *TopOfertas* ✨ especialista na Progressiva Vegetal. Qual o seu nome? Posso te explicar como funciona o tratamento?";
  } else {
    opening = (set.opening_B?.[0])
      || "Oi! Eu sou a Cláudia, prazer falar com você 😊 Como posso te chamar? Quer que eu te explique rapidinho sobre a Progressiva Vegetal?";
  }

  // 5) De vez em quando, iniciar usando o nome (se já conhecido)
  if (name && shouldUseName(0.5)) {
    // injeta o nome de forma natural no início
    opening = opening.replace(/^Oi[,!]\s*/i, `Oi, ${name}! `);
    // se a frase já não tiver pergunta de nome, não duplica
    opening = opening.replace(/Qual o seu nome\??/i, "").replace(/Como posso te chamar\??/i, "").trim();
  }

  // 6) Encaminha para a próxima etapa (qualificação)
  return {
    reply: tagReply(settings, opening, `flow/greet#${variant}`),
    next: "qualificacao",
    meta: { variant } // preserva pro restante do funil/telemetria
  };
}
