// configs/bots/claudia/flow/greet.js
// Abertura moderna: capta nome, reforça que serve para todos os tipos e pergunta o objetivo.
// Se a cliente já disser "frizz/volume/brilho/alisar", devolve a oferta de preços e encaminha para offer.
// Devolve carimbo via meta.tag.

import { normalizeSettings, tagReply } from "./_state.js";

const RX = {
  HI: /\b(oi|ol[aá]|bom dia|boa tarde|boa noite|hey|hello)\b/i,
  NAME_IS: /\b(meu nome (?:e|é)|sou a?|me chamo)\b/i,
  GOAL_FRIZZ: /\b(frizz|fris|arrepiad)/i,
  GOAL_VOLUME: /\b(volume|volumoso|armad)/i,
  GOAL_BRILHO: /\b(brilho|brilhante|brilhar)\b/i,
  GOAL_ALISAR: /\b(alisar|liso|chapar)\b/i,
};

function tag(text, t) { return tagReply({}, text, t); }

function wantsGoal(txt="") {
  const t = txt.toLowerCase();
  if (RX.GOAL_FRIZZ.test(t)) return "frizz";
  if (RX.GOAL_VOLUME.test(t)) return "volume";
  if (RX.GOAL_BRILHO.test(t)) return "brilho";
  if (RX.GOAL_ALISAR.test(t)) return "alisar";
  return null;
}

export default async function greet(ctx = {}) {
  const { text = "", profile = {}, settings = {}, state = {} } = ctx;
  const S = normalizeSettings(settings);
  const name = profile?.name || state?.profile?.name || "";

  // 1) Se já veio um objetivo na primeira mensagem, atenda direto
  const goal = wantsGoal(text);
  if (goal) {
    const msg =
      `Perfeito! A **${S.product.name}** serve para **todos os tipos de cabelo** e ` +
      `**hidrata profundamente enquanto alinha** — é excelente para **${goal}**.\n\n` +
      `Hoje temos:\n` +
      `• Preço cheio: **R$ ${S.product.price_original},00**\n` +
      `• Promo do dia: **R$ ${S.product.price_target},00**\n` +
      `• **${S.product.promo_day_quota || 5} unidades relâmpago por R$ ${S.product.price_promo_day},00** 🎉\n\n` +
      `Quer que eu verifique o **R$ ${S.product.price_promo_day},00** no seu endereço com **pagamento só na entrega**? ` +
      `Entrega rápida: **até ${S.product.delivery_sla.capitals_hours}h nas capitais** e **até ${S.product.delivery_sla.others_hours}h** nas demais.`;
    // Sinalizamos que o próximo passo é o offer (ele já vai pedir CEP+cidade)
    state.stage = "oferta";
    return tag(msg, "flow/greet→offer");
  }

  // 2) Se não conheço o nome, peça de forma simpática
  if (!name) {
    const msg =
      `Oi! Eu sou a Cláudia da *${S.product.store_name}* 💚 ` +
      `Como posso te chamar? Você já conhece a nossa **${S.product.name}**, 100% livre de formol?`;
    return tag(msg, "flow/greet#opening");
  }

  // 3) Se já tenho o nome, explique rápido e pergunte o objetivo
  const msg =
    `Prazer, ${name}! A **${S.product.name}** serve para **todos os tipos de cabelo**. ` +
    `Ela **hidrata profundamente enquanto alinha**: pode **alisar**, **reduzir frizz**, **baixar volume** ou dar ` +
    `aquele **brilho de salão em casa**. Qual seu maior objetivo?`;
  return tag(msg, "flow/greet#opening_named");
}
