// configs/bots/claudia/flow/greet.js
// Abertura objetiva: capta nome, reforça que serve para todos os tipos
// e pergunta o objetivo (frizz/volume/brilho/alisar). Se já vier objetivo,
// encaminha direto para o offer mantendo o carimbo.

import { normalizeSettings, tagReply } from "./_state.js";

const RX = {
  GOAL_FRIZZ: /\b(frizz|fris|arrepiad)/i,
  GOAL_VOLUME: /\b(volume|volumoso|armad)/i,
  GOAL_BRILHO: /\b(brilho|brilhante|brilhar)\b/i,
  GOAL_ALISAR: /\b(alisar|liso|chapar)\b/i,
};

function tag(text, t) { return tagReply({}, text, t); }

function wantsGoal(txt="") {
  const t = txt.toLowerCase();
  if (RX.GOAL_FRIZZ.test(t)) return "reduzir frizz";
  if (RX.GOAL_VOLUME.test(t)) return "baixar volume";
  if (RX.GOAL_BRILHO.test(t)) return "mais brilho";
  if (RX.GOAL_ALISAR.test(t)) return "alisar";
  return null;
}

export default async function greet(ctx = {}) {
  const { text = "", profile = {}, settings = {}, state = {} } = ctx;
  const S = normalizeSettings(settings);
  const name = profile?.name || state?.profile?.name || "";

  // 1) Se já veio objetivo, antecipa oferta e empurra para offer
  const goal = wantsGoal(text);
  if (goal) {
    const msg =
      `Perfeito! A ${S.product.name} serve para todos os tipos de cabelo e ` +
      `hidrata profundamente enquanto alinha — é ótima para ${goal}.\n\n` +
      `Condição de hoje:\n` +
      `• Preço cheio: R$ ${S.product.price_original},00\n` +
      `• Promo do dia: R$ ${S.product.price_target},00\n` +
      `• ${S.product.promo_day_quota || 5} unidades relâmpago por R$ ${S.product.price_promo_day},00 🎉\n\n` +
      `Quer que eu verifique o R$ ${S.product.price_promo_day},00 no seu endereço com pagamento só na entrega?\n` +
      `Prazo: até ${S.product.delivery_sla.capitals_hours}h capitais / até ${S.product.delivery_sla.others_hours}h demais.`;
    state.stage = "oferta";
    return tag(msg, "flow/greet→offer");
  }

  // 2) Sem nome ainda → pedir nome de forma humana (sem falar que é IA)
  if (!name) {
    const msg =
      `Oi! Eu sou a Cláudia da ${S.product.store_name} 💚 ` +
      `Como posso te chamar? Você já ouviu falar da ${S.product.name}? Ela é livre de formol.`;
    return tag(msg, "flow/greet#opening");
  }

  // 3) Com nome → pergunta objetiva
  const msg =
    `Prazer, ${name}! A ${S.product.name} funciona em todos os tipos de cabelo. ` +
    `Você quer mais é alisar, reduzir frizz, baixar volume ou só dar brilho de salão em casa?`;
  return tag(msg, "flow/greet#opening_named");
}
