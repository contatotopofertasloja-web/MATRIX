// src/core/prompts/products.js
// Helpers neutros de PRODUTO para N vendedoras (multi-bot).
// Este arquivo NÃO impõe roteiro de venda: fornece fatos/compliance/strings seguras
// que podem ser consumidas por flows ou pelo core/base quando necessário.

function asBool(v, d = false) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase();
  if (!s) return d;
  return ["1","true","yes","y","on"].includes(s);
}

export function selectActiveProduct(settings = {}) {
  // Regras:
  // 1) Se houver settings.product, ele é o ativo.
  // 2) Caso exista settings.catalog (array), usa o primeiro com active=true.
  // 3) Fallback: primeiro item do catalog.
  const p = settings?.product || null;
  if (p && typeof p === "object") return p;

  const catalog = Array.isArray(settings?.catalog) ? settings.catalog : [];
  const active  = catalog.find(x => asBool(x?.active, false));
  if (active) return active;
  return catalog[0] || {};
}

export function buildProductFacts(settings = {}) {
  const product = selectActiveProduct(settings);
  const company = settings?.company || {};
  const marketing = settings?.marketing || {};
  const payments = settings?.payments || {};

  const sold = Number(marketing?.sold_count || settings?.messages?.sold_count || 0);

  const priceOriginal = Number(product?.price_original || 0) || null;
  const priceTarget   = Number(product?.price_target   || 0) || null;

  const facts = {
    company: {
      name: company?.name || settings?.company_name || "",
      hours: company?.hours || settings?.company_hours || "",
    },
    product: {
      name: product?.name || settings?.product?.name || "",
      volume_ml: product?.volume_ml || null,
      how_to_use: product?.how_to_use || "",
      safety: product?.safety || "",
    },
    price: {
      original: priceOriginal,
      target: priceTarget,
      currency: "BRL",
    },
    checkout: {
      url: product?.checkout_link || settings?.product?.checkout_link || "",
      allowed: true, // a verificação fina (whitelist) é responsabilidade do flow/core-guard
    },
    delivery: {
      capitals_hours: product?.delivery_sla?.capitals_hours ?? settings?.product?.delivery_sla?.capitals_hours ?? null,
      others_hours:   product?.delivery_sla?.others_hours   ?? settings?.product?.delivery_sla?.others_hours   ?? null,
    },
    payments: {
      cod_enabled: asBool(settings?.flags?.has_cod ?? true, true),
      installments_enabled: asBool(payments?.installments?.enabled ?? true, true),
      installments_max: Number(payments?.installments?.max_installments || 12),
      cod_text: settings?.messages?.cod_short || "Pagamento na entrega (COD).",
    },
    marketing: {
      sold_count: sold,
      sweepstakes_enabled: asBool(settings?.marketing?.sweepstakes_enabled ?? false, false),
    },
  };

  return facts;
}

/**
 * (Opcional) Caso você queira usar este módulo como builder de prompt
 * em algum projeto legado, expomos buildPrompt minimalista.
 * Por padrão, o core usa o builder do base.js adaptado pelo index.js.
 */
export async function buildPrompt({ stage, message, context } = {}) {
  const settings = context?.settings || {};
  const facts = buildProductFacts(settings);

  const system = [
    `Você é uma vendedora humana, consultiva e cordial.`,
    `Use respostas curtas e objetivas (até 2 frases + 1 pergunta), com no máximo 1 emoji.`,
    `Não invente preço/link. Se não houver dados válidos, peça permissão para consultar ou informe que irá verificar.`,
    `Fatos conhecidos (para esta sessão):`,
    `- Empresa: ${facts.company.name || "n/d"} | Horário: ${facts.company.hours || "n/d"}`,
    `- Produto: ${facts.product.name || "n/d"} (${facts.product.volume_ml ? facts.product.volume_ml + " ml" : "volume n/d"})`,
    `- Preço: ${facts.price.target ? "R$" + facts.price.target : "n/d"} (de ${facts.price.original ? "R$"+facts.price.original : "n/d"})`,
    `- Checkout permitido: ${facts.checkout.url ? "sim" : "não"}`,
    `- Entrega (capitais/outros): ${facts.delivery.capitals_hours || "n/d"}h / ${facts.delivery.others_hours || "n/d"}h`,
    `- Pagamento: ${facts.payments.cod_enabled ? "COD" : "cartão/boleto"}; Parcelamento até ${facts.payments.installments_max}x`,
    `- Vendidos: ${facts.marketing.sold_count || 0}`,
  ].join("\n");

  const user = `Usuário: "${message || ""}" | Sinal de estágio: ${stage || "greet"}`;
  return { system, user };
}

export default {
  selectActiveProduct,
  buildProductFacts,
  buildPrompt,
};
