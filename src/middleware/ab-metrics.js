// src/middleware/ab-metrics.js
// Middleware fino para registrar métricas A/B sem poluir o core.
// Ele reusa o coletor que criamos em src/core/metrics/middleware.js.

import { captureFromActions } from "../core/metrics/middleware.js";

/**
 * Chamada direta após o orquestrador.
 * @param {Object} params
 * @param {Array}  params.actions   - Ações retornadas pelo orquestrador [{kind, text, url, meta}]
 * @param {String} params.jid       - ID do usuário/contato
 * @param {String} params.stage     - Estágio atual (qualify, offer, close, postsale...)
 * @param {String} params.variant   - Variante A/B (ex.: "A" | "B" | null)
 * @param {Boolean} params.askedPrice - Se a mensagem indicou intenção de preço
 * @param {Boolean} params.askedLink  - Se a mensagem indicou intenção de link/checkout
 * @param {String} [params.botId="claudia"]
 */
export async function afterOrchestrate({
  actions = [],
  jid,
  stage,
  variant = null,
  askedPrice = false,
  askedLink = false,
  botId = "claudia",
}) {
  try {
    await captureFromActions(actions, {
      botId,
      jid,
      stage,
      variant,
      askedPrice,
      askedLink,
    });
  } catch (e) {
    console.warn("[ab-metrics] capture skip:", e?.message || e);
  }
}

/**
 * Envelopa uma função orquestradora para gravar métricas automaticamente.
 * Útil se você preferir não mexer no corpo do orquestrador.
 *
 * Exemplo:
 *   import { wrapOrchestrator } from "./middleware/ab-metrics.js";
 *   export const orchestrate = wrapOrchestrator(baseOrchestrate);
 *
 * @param {(input:{jid:string,text:string})=>Promise<Array>} orchestrateFn
 * @param {Object} [opts]
 * @param {string} [opts.botId="claudia"]
 */
export function wrapOrchestrator(orchestrateFn, { botId = "claudia" } = {}) {
  if (typeof orchestrateFn !== "function") {
    throw new TypeError("wrapOrchestrator requer uma função orquestradora");
  }
  return async function wrapped(input) {
    const actions = await orchestrateFn(input);
    // tenta extrair meta.variant/meta.stage das ações; senão usa o que vier do chamador
    const variant = actions?.find(a => a?.meta?.variant)?.meta?.variant || null;
    const stage   = actions?.find(a => a?.meta?.stage)?.meta?.stage || null;

    // heurística leve para intenção do usuário (compat com os mesmos regex do orquestrador)
    const msg = String(input?.text || "");
    const RX_ASK_PRICE = /\b(preç|valor|quanto|cust)/i;
    const RX_ASK_LINK  = /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho|pagamento)\b/i;

    await afterOrchestrate({
      actions,
      jid: input?.jid,
      stage,
      variant,
      askedPrice: RX_ASK_PRICE.test(msg),
      askedLink:  RX_ASK_LINK.test(msg),
      botId,
    });

    return actions;
  };
}

export default { afterOrchestrate, wrapOrchestrator };
