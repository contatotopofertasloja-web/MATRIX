// configs/bots/claudia/flow/qualify.js
// Roteador leve:
// - NÃO repete a explicação (isso é do greet).
// - Detectou objetivo? → pré-CEP (R$197 → R$170) pedindo Cidade/UF + CEP.
// - Não detectou? → nudge curto perguntando o objetivo.
// - Para 1 bolha, retornamos diretamente tagReply (compatível com o orchestrator).

import { ensureProfile, tagReply, normalizeSettings } from "./_state.js";

const T = (s = "") => String(s).normalize("NFC");

// Detector simples de objetivo
function detectGoal(s = "") {
  const t = T(s).toLowerCase();
  if (/\balis(ar|amento)|liso|progressiva\b/.test(t)) return "alisar";
  if (/\bfrizz|arrepiad/.test(t)) return "frizz";
  if (/\b(baixar|reduzir|diminuir)\s+volume\b|\bvolume\b/.test(t)) return "volume";
  if (/\bbrilho|brilhos[oa]|iluminar\b/.test(t)) return "brilho";
  return null;
}

// Preços/links com defaults seguros
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

  // 1) Objetivo detectado → envia APENAS a oferta curta (pré-CEP)
  if (goal) {
    profile.goal = goal;
    state.stage = "offer.ask_cep_city";

    const { original, target } = safePrices(settings);

    return tagReply(
      ctx,
      "Hoje a nossa condição está assim:\n" +
        `💰 *Preço cheio: R$${original}*\n` +
        `🎁 *Promo do dia: R$${target}*\n\n` +
        "Quer que eu *consulte no sistema* se existe alguma *promoção especial* liberada para o seu endereço?\n" +
        "Se sim, me envia *Cidade/UF + CEP* (ex.: *São Paulo/SP – 01001-000*).",
      "flow/offer#precheck_special"
    );
  }

  // 2) Sem objetivo ainda → nudge curto
  return tagReply(
    ctx,
    "Me conta rapidinho: qual é o *seu objetivo hoje* — *alisar, reduzir frizz, baixar volume* ou *dar brilho*?",
    "flow/qualify#objective_nudge_only"
  );
}
