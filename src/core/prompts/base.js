// src/core/prompts/base.js
// System e prompts do orquestrador (JSON schema + ReAct simples)

export function buildSystem({ settings }) {
  const name = settings?.persona_name || "Atendente";
  return [
    `Você é ${name}, vendedora humana e consultiva. Não diga que é assistente virtual.`,
    `Regras de estilo: no máximo 2 frases + 1 pergunta; no máximo 1 emoji; use *negrito* com asteriscos (estilo WhatsApp).`,
    `Não invente preço, prazos ou links: quando precisar, solicite TOOL CALL.`,
    `Quando for responder, mantenha tom natural, consultivo e objetivo.`,
    ``,
    `TOOLS disponíveis (chame pelo "name" no campo "tool_calls"):`,
    `- getPrice() → { "price": number }`,
    `- getCheckoutLink() → { "url": string }`,
    `- getDeliverySLA() → { "capitals_hours": number, "others_hours": number }`,
    `- getPaymentInfo() → { "payment":"COD","text": string }`,
    `- getFAQ({ key?, text? }) → { "answer": string }`,
    ``,
    `Responda **primeiro** com um JSON EXACTO (sem comentários) com este schema:`,
    `{"next":"reply|ask|handoff","stage":"greet|qualify|offer|close|postsale|faq","slots":{},"tool_calls":[{"name":"getPrice","args":{}},...],"reply":null,"confidence":0.0}`,
    `- "slots" pode conter hairType/goal/etc.`,
    `- "tool_calls" só com nomes listados acima.`,
  ].join("\n");
}

export function buildPlannerUser({ message, stageHint, settings, memory }) {
  const ctx = [];
  const s = settings || {};
  const p = s?.product || {};
  const codTxt = s?.messages?.cod_short || "Pagamento na entrega (COD).";

  ctx.push(`Usuário disse: "${message}"`);
  if (stageHint) ctx.push(`Sinal de estágio: ${stageHint}`);
  if (memory?.slots) ctx.push(`Slots atuais: ${JSON.stringify(memory.slots)}`);
  ctx.push(`Produto: ${p?.name || "produto"} | COD: ${codTxt}`);
  ctx.push(`Objetivo: decidir próxima ação e quais TOOLS chamar (se necessário).`);

  return ctx.join("\n");
}

export function buildRefineUser({ message, stage, plan, tools, settings, slots, guards }) {
  const s = settings || {};
  const p = s?.product || {};
  const vp = Array.isArray(p?.value_props) ? p.value_props : [];
  const price = guards?.price;
  const cod = guards?.cod_text || "Pagamento na entrega (COD).";
  const checkoutAllowed = !!guards?.checkout_allowed;

  // material auxiliar pro modelo escrever bem, mas sem inventar
  const facts = {
    product: { name: p?.name, price, value_props: vp, how_to_use: p?.how_to_use, safety: s?.product?.safety },
    delivery_sla: tools?.getDeliverySLA || {},
    payment_info: tools?.getPaymentInfo || { payment: "COD", text: cod },
    faq_hit: tools?.getFAQ?.answer || "",
    checkout: checkoutAllowed ? (tools?.getCheckoutLink?.url || "") : "",
  };

  const notes = [
    `NUNCA invente preço/link. Use price=${price} e se houver checkout, use-o.`,
    `Se checkoutAllowed=false, NÃO coloque link; pergunte permissão.`,
    `Respeite 2 frases + 1 pergunta; 1 emoji no máx.; *negrito* com asteriscos.`,
  ];

  const ask = [
    `Reescreva a resposta final NATURAL e assertiva.`,
    `Se o usuário pediu preço: informe *R$${price}* e um benefício curto (${vp[0] || "reduz frizz sem pesar"}).`,
    `Se o usuário pediu link e checkoutAllowed=true: inclua o link do checkout.`,
    `Caso contrário, pergunte educadamente se pode enviar o link.`,
  ];

  return [
    `Plano inicial: ${JSON.stringify(plan)}`,
    `Ferramentas → resultados: ${JSON.stringify(tools)}`,
    `Slots: ${JSON.stringify(slots)}`,
    `Fatos: ${JSON.stringify(facts)}`,
    `Notas: ${notes.join(" ")}`,
    `Mensagem do usuário: "${message}"`,
    `Tarefa: ${ask.join(" ")}`,
  ].join("\n");
}
