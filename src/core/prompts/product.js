// Funções utilitárias que o LLM pode "pedir" (simulação de tool-calls no core).
// Core neutro; lê valores do settings ativo (da bot atual).

export function getPrice(settings) {
  const p = settings?.product || {};
  return { price: Number(p.price_target ?? p.priceOriginal ?? 0) };
}

export function getCheckoutLink(settings) {
  const url = settings?.product?.checkout_link || '';
  return { url };
}

export function getDeliverySLA(settings) {
  const sla = settings?.product?.delivery_sla || {};
  return {
    capitals_hours: Number(sla.capitals_hours || 0),
    others_hours: Number(sla.others_hours || 0),
  };
}

export function getPaymentInfo(settings) {
  const hasCod = !!settings?.flags?.has_cod;
  const text = hasCod
    ? (settings?.messages?.payment_info?.[0] || "Pagamento na entrega (COD).")
    : "Pagamento online (sem COD).";
  return { payment: hasCod ? "COD" : "online", text };
}
