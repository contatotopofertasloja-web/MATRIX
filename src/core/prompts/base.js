// System e prompts do orquestrador (JSON schema + ReAct simples)
// Core neutro (sem cheiro de bot específico). Cada bot define persona em settings.yaml.

export function buildSystem({ settings }) {
  const name = settings?.persona_name || "Atendente";
  const company = settings?.company?.name || "nossa loja";
  return [
    `Você é ${name}, vendedora humana e consultiva da ${company}. Não diga que é IA.`,
    `Estilo: até 2 frases + 1 pergunta; no máximo 1 emoji; use *negrito* com asteriscos (padrão WhatsApp).`,
    `Nunca invente preços, prazos ou links. Para isso, sinalize TOOLS: getPrice, getCheckoutLink, getDeliverySLA, getPaymentInfo.`,
    `Se faltar dado, pergunte de forma natural.`
  ].join('\n');
}

/**
 * Prompt do PLANNER (planejamento da próxima ação).
 * Saída esperada: JSON válido (sem comentários) com o seguinte shape:
 * {
 *   "next": "reply" | "ask" | "tools" | "handoff",
 *   "stage": "greet" | "qualify" | "offer" | "objection" | "close" | "postsale",
 *   "tool_calls": [ { "name": "getPrice", "args": { } } ],
 *   "slots": { "nome": "Ana", "tipo_cabelo": "ondulado", ... },
 *   "reply": "rascunho de resposta opcional",
 *   "confidence": 0.0 - 1.0
 * }
 */
export function buildPlannerUser({ message, stageHint, settings, memory }) {
  const s = settings || {};
  const p = s?.product || {};
  const codTxt = s?.messages?.cod_short || "Pagamento na entrega (COD).";

  const ctx = [];
  ctx.push(`Usuário disse: "${message}"`);
  if (stageHint) ctx.push(`Sinal de estágio: ${stageHint}`);
  if (memory?.slots) ctx.push(`Slots atuais: ${JSON.stringify(memory.slots)}`);
  ctx.push(`Produto: ${p?.name || "produto"} | COD: ${codTxt}`);
  ctx.push(`Ferramentas disponíveis: getPrice, getCheckoutLink, getDeliverySLA, getPaymentInfo`);
  ctx.push(`Objetivo: decidir próxima ação e quais TOOLS chamar, retornando APENAS JSON válido (sem texto fora do JSON).`);
  return ctx.join("\n");
}

/**
 * Prompt do REFINO (gera a resposta final para o usuário).
 * Recebe o plano do planner + resultados de TOOLS já executadas.
 */
export function buildRefineUser({ message, stage, plan, tools, settings, slots, guards }) {
  const toolsResult = tools && typeof tools === 'object' ? tools : {};
  const lines = [
    `Mensagem do usuário: "${message}"`,
    `Estágio atual: ${stage || "-"}`,
    `Plano do planner (JSON): ${JSON.stringify(plan || {}, null, 0)}`,
    `Resultados das TOOLS executadas (JSON): ${JSON.stringify(toolsResult || {}, null, 0)}`,
    `Slots conhecidos: ${JSON.stringify(slots || {}, null, 0)}`,
    `Guardrails: ${JSON.stringify(guards || {}, null, 0)}`,
    `Tarefa: valide/ajuste o plano e produza a MELHOR resposta final, em tom humano e natural, obedecendo:
      - máx. 2 frases + 1 pergunta;
      - no máx. 1 emoji;
      - sem inventar números/links (use os guardrails/tools fornecidos);
      - se faltar info, pergunte de forma simples.`
  ];
  return lines.join("\n");
}

// Alias para compat com versões antigas (se algum ponto do código ainda chamar buildUser)
export const buildUser = buildPlannerUser;
