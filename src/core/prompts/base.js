// System e prompts do orquestrador (JSON schema + ReAct simples)
// Core neutro (sem cheiro de Cláudia/TopOfertas). Bots definem identidade em settings.yaml.

export function buildSystem({ settings }) {
  const name = settings?.persona_name || "Atendente";
  const company = settings?.company?.name || "nossa loja";
  return [
    `Você é ${name}, vendedora humana e consultiva da ${company}. Não diga que é assistente virtual.`,
    `Estilo: no máximo 2 frases + 1 pergunta; no máximo 1 emoji; use *negrito* com asteriscos (WhatsApp).`,
    `Não invente preço, prazos ou links: quando precisar, peça TOOLS (getPrice, getCheckoutLink, getDeliverySLA, getPaymentInfo).`,
    `Não responda com placeholders. Se faltar dado, pergunte de forma natural.`,
  ].join('\n');
}

export function buildUser({ message, stage, settings, memory }) {
  const stageHint = (stage || '').toString();
  const s = settings || {};
  const p = s?.product || {};
  const codTxt = s?.messages?.cod_short || "Pagamento na entrega (COD).";

  const ctx = [];
  ctx.push(`Usuário disse: "${message}"`);
  if (stageHint) ctx.push(`Sinal de estágio: ${stageHint}`);
  if (memory?.slots) ctx.push(`Slots atuais: ${JSON.stringify(memory.slots)}`);
  ctx.push(`Produto: ${p?.name || "produto"} | COD: ${codTxt}`);
  ctx.push(`Objetivo: decidir próxima ação e quais TOOLS chamar (se necessário).`);
  return ctx.join("\n");
}

export function buildRefineUser({ message, stage, plan, tools, settings, slots, guards }) {
  return [
    `Mensagem anterior: "${message}"`,
    `Plano proposto: ${JSON.stringify(plan)}`,
    `Ferramentas possíveis: ${tools?.map(t => t?.name).join(', ') || '-'}`,
    `Slots: ${JSON.stringify(slots || {})}`,
    `Guardrails: ${JSON.stringify(guards || {})}`,
    `Valide o plano, chame TOOLS se precisar (apenas nomes e argumentos), e gere a resposta final.`,
  ].join('\n');
}
