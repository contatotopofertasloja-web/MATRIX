// configs/bots/claudia/flow/close.js
// Fechamento do funil: confirma dados, reforça promo, leva ao checkout COD.

import {
  callUser, tagReply, filledSummary, normalizeSettings
} from "./_state.js";
import { recall, remember } from "../../../../src/core/memory.js";

export default async function close(ctx = {}) {
  const { jid, state = {}, settings = {} } = ctx;
  const S = normalizeSettings(settings);

  // carrega profile persistente
  try {
    const saved = await recall(jid);
    if (saved?.profile) {
      state.profile = { ...(state.profile || {}), ...saved.profile };
    }
  } catch (e) {
    console.warn("[close.recall]", e?.message);
  }

  const name = callUser(state);
  const resumo = filledSummary(state);
  const rat = resumo.length ? `Anotei: ${resumo.join(" · ")}.` : "";

  // mensagem principal
  let msg = "";
  if (name) {
    msg += `${name}, `;
  }
  msg += `${rat} Pra finalizar: nossa promoção é de *R$ ${S.product.price_target} na entrega*.`;
  msg += `\n\nPosso gerar agora o link do checkout COD pra você confirmar?`;

  // persiste profile atualizado
  try {
    await remember(jid, { profile: state.profile });
  } catch (e) {
    console.warn("[close.remember]", e?.message);
  }

  return tagReply(S, msg, "flow/close");
}
