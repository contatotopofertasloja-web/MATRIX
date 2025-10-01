// configs/bots/claudia/flow/qualify.js
// Roteador leve:
// - NÃO repete a explicação (isso fica no greet).
// - Se detectar objetivo → envia pré-CEP (R$197 → R$170) e pede Cidade/UF + CEP.
// - Se não detectar → nudge curto perguntando o objetivo.
// - Sempre retorna em replies[] (compatível com o orchestrator).

import { ensureProfile, tagReply, normalizeSettings } from "./_state.js";

const T = (s = "") => String(s).normalize("NFC");

// Detecta objetivo no texto livre
function detectGoal(s = "") {
  const t = T(s).toLowerCase();
  if (/\balis(ar|amento)|liso|progressiva\b/.test(t)) return "alisar";
  if (/\bfrizz|arrepiad/.test(t)) return "frizz";
  if (/\b(baixar|reduzir|diminuir)\s+volume\b|\bvolume\b/.test(t)) return "volume";
  if (/\bbrilho|brilhos[oa]|iluminar\b/.test(t)) return "brilho";
  return null;
}

// Defaults seguros de preços/links
function safePrices(settings = {}) {
  const S = normalizeSettings(settings) || {};
  const original = Number(S?.product?.price_original ?? 197);
  const target   = Number(S?.product?.price_target   ?? 170);
  const checkout = S?.product?.checkout_link || "";
  return { original, target, checkout };
}

export default async function qualify(ctx = {}) {
  const { state = {}, text = "", settings = {} } = ctx;
  const profile = ensureProfile(state);
  const { original, target } = safePrices(settings);

  const s = T(text).trim();
  const goal = detectGoal(s) || profile.goal || null;

  // 1) Objetivo detectado → direciona para OFFER (pré-CEP)
  if (goal) {
    profile.goal = goal;
    state.stage = "offer.ask_cep_city";

    const msg = tagReply(
      ctx,
      `Perfeito! Hoje a nossa condição está assim:\n` +
        `💰 *Preço cheio: R$${original}*\n` +
        `🎁 *Promo do dia: R$${target}*\n\n` +
        `Quer que eu *consulte no sistema* se existe *promoção especial* pro seu endereço?\n` +
        `Se sim, me envia *Cidade/UF + CEP* (ex.: *São Paulo/SP – 01001-000*).`,
      "flow/offer#precheck_special"
    );

    return { replies: [msg], meta: { tag: "flow/offer#precheck_special" } };
  }

  // 2) Sem objetivo ainda → nudge curto (sem explicação; greet cuida disso)
  const nudge = tagReply(
    ctx,
    `Me conta rapidinho: qual é o *seu objetivo hoje* — *alisar, reduzir frizz, baixar volume* ou *dar brilho*?`,
    "flow/qualify#objective_nudge_only"
  );

  return { replies: [nudge], meta: { tag: "flow/qualify#objective_nudge_only" } };
}
