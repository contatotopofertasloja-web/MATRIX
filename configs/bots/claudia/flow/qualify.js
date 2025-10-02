// configs/bots/claudia/flow/qualify.js
// Roteador de objetivo:
// - Detecta objetivo em texto livre.
// - Objetivo detectado → 1) confirmação do objetivo, 2) TRANSIÇÃO suave, 3) oferta curta (pré-CEP).
// - Sem objetivo → nudge curto perguntando o objetivo.
// - Sempre retorna em replies[] (compatível com orchestrator).

import { ensureProfile, tagReply, normalizeSettings } from "./_state.js";

const T = (s = "") => String(s).normalize("NFC").toLowerCase();

function detectGoal(s = "") {
  const t = T(s);
  if (/\balis(ar|amento)|liso|progressiva\b/.test(t)) return "alisar";
  if (/\bfrizz|arrepiad/.test(t)) return "frizz";
  if (/\b(baixar|reduzir|diminuir)\s+volume\b|\bvolume\b/.test(t)) return "volume";
  if (/\bbrilho|brilhos[oa]|iluminar\b/.test(t)) return "brilho";
  return null;
}

// 1ª bolha: confirmação do objetivo (texto curto e específico)
function goalAck(ctx, goal) {
  switch (goal) {
    case "alisar":
      return tagReply(
        ctx,
        "Perfeito 💚! A Progressiva Vegetal foi criada justamente pra isso: *liso natural*, *sem formol* e com *efeito de salão*.",
        "flow/goal#alisar"
      );
    case "frizz":
      return tagReply(
        ctx,
        "Perfeito 💚! Ela *reduz o frizz* já na primeira aplicação, *sem formol* e com *hidratação potente*.",
        "flow/goal#frizz"
      );
    case "volume":
      return tagReply(
        ctx,
        "Perfeito 💚! Ela *baixa o volume* alinhando os fios, sem perder movimento — *sem formol*.",
        "flow/goal#volume"
      );
    case "brilho":
      return tagReply(
        ctx,
        "Perfeito 💚! Ela *devolve brilho e maciez*, nutrindo enquanto alinha — *sem formol*.",
        "flow/goal#brilho"
      );
    default:
      return tagReply(ctx, "Perfeito 💚! Anotei seu objetivo.", "flow/goal#generic");
  }
}

// Defaults seguros de preço (usando settings do bot, com fallback)
function safePrices(settings = {}) {
  const S = normalizeSettings(settings) || {};
  const original = Number(S?.product?.price_original ?? 197);
  const target   = Number(S?.product?.price_target   ?? 170);
  return { original, target };
}

export default async function qualify(ctx = {}) {
  const { state = {}, text = "", settings = {} } = ctx;
  const profile = ensureProfile(state);

  const goal = detectGoal(text) || profile.goal || null;

  // Objetivo detectado → confirmação + TRANSIÇÃO + oferta curta (pré-CEP)
  if (goal) {
    profile.goal = goal;
    state.stage = "offer.ask_cep_city";

    const { original, target } = safePrices(settings);

    // 1) Confirma objetivo
    const ack = goalAck(ctx, goal);

    // 2) TRANSIÇÃO suave para a oferta
    const transition = tagReply(
      ctx,
      "E olha, pra você que busca esse resultado, a condição de hoje tá especial 👇",
      "flow/goal→offer_transition"
    );

    // 3) Oferta curta (pré-CEP)
    const precheck = tagReply(
      ctx,
      "Hoje a nossa condição está assim:\n" +
        `💰 *Preço cheio: R$${original}*\n` +
        `🎁 *Promo do dia: R$${target}*\n\n` +
        "Quer que eu *consulte no sistema* se existe alguma *promoção especial* liberada para o seu endereço?\n" +
        "Se sim, me envia *Cidade/UF + CEP* (ex.: *São Paulo/SP – 01001-000*).",
      "flow/offer#precheck_special"
    );

    return { replies: [ack, transition, precheck], meta: { tag: "flow/offer#precheck_special" } };
  }

  // Sem objetivo ainda → nudge curto (greet já cuidou da explicação)
  const nudge = tagReply(
    ctx,
    "Me conta rapidinho: qual é o *seu objetivo hoje* — *alisar, reduzir frizz, baixar volume* ou *dar brilho*?",
    "flow/qualify#objective_nudge_only"
  );
  return { replies: [nudge], meta: { tag: "flow/qualify#objective_nudge_only" } };
}
