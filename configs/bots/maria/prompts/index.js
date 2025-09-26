// configs/bots/maria/prompts/index.js
// Builder de prompt da Maria: simples, direto, sem “assistente virtual”.

const STAGE_ALIASES = {
  recepcao:     ['recepcao', 'recepção', 'greet', 'hello', 'saudacao', 'saudação', 'start'],
  qualificacao: ['qualificacao', 'qualificação', 'qualify'],
  oferta:       ['oferta', 'offer', 'apresentacao', 'apresentação', 'pitch'],
  objecoes:     ['objecoes', 'objeções', 'objection', 'negociacao', 'negociação'],
  fechamento:   ['fechamento', 'close', 'checkout', 'closing'],
  posvenda:     ['posvenda', 'pósvenda', 'postsale', 'pos_venda', 'pós_venda'],
};

function normalizeStage(stage) {
  const s = String(stage || '').toLowerCase();
  for (const key of Object.keys(STAGE_ALIASES)) {
    if (s === key || STAGE_ALIASES[key].some(a => s.includes(a))) return key;
  }
  return 'recepcao';
}

/**
 * buildPrompt({ stage, message, settings, faq })
 * - stage: etapa presumida (ex.: 'greet', 'offer', 'close', etc.)
 * - message: texto do usuário
 * - settings: (opcional) objeto carregado do settings.yaml da Maria
 * - faq: (opcional) conteúdo já parseado do faq.yaml (se você quiser injetar no system)
 */
export function buildPrompt({ stage, message, settings, faq } = {}) {
  const st = normalizeStage(stage);
  const user = String(message || '');

  // Extratos úteis do settings (não quebra se vier vazio)
  const price  = settings?.product?.price_target ?? settings?.product?.price ?? '';
  const link   = settings?.product?.checkout_link ?? settings?.product?.site_url ?? '';
  const hasCOD = settings?.flags?.has_cod ?? true;

  // Guardrails essenciais para a Maria
  const COMMON_RULES = [
    // Identidade & tom
    'Você é Maria, vendedora simpática e objetiva. PT-BR. Nunca diga que é uma “assistente virtual”.',
    'Responda sempre em frases curtas e diretas, como conversa de WhatsApp. Evite blocos grandes.',
    // Conteúdo permitido
    'Fale apenas sobre o produto atual e políticas existentes. Não invente preços, descontos, prazos ou links.',
    // Oferta & checkout
    'Quando o cliente perguntar preço/valor, informe o preço do settings e ofereça o link seguro do checkout.',
    hasCOD ? 'Explique que o pagamento é na entrega (COD) quando for pertinente.' : '',
    // Modo de uso
    'Se pedirem “como usar”, responda em até 3 linhas, simples e passo-a-passo.',
    // Acessibilidade (cliente com baixa instrução)
    'Ao perguntar sobre o cabelo, ofereça opções objetivas: liso, ondulado, cacheado ou crespo.',
    // Postura
    'Se houver objeção, responda com segurança e convide educadamente para seguir ao checkout.',
  ].filter(Boolean);

  // Regras por etapa — ultra curtas
  let stageRules = [];
  if (st === 'recepcao') {
    stageRules = [
      'Pergunte de forma objetiva o tipo de cabelo (liso/ondulado/cacheado/crespo); se o cliente já disse, avance para a recomendação.',
    ];
  } else if (st === 'qualificacao') {
    stageRules = [
      'Faça no máximo 2 perguntas relevantes (ex.: frizz ou volume; já fez progressiva; resultado desejado).',
    ];
  } else if (st === 'oferta') {
    stageRules = [
      'Informe o preço e ofereça o link do checkout em 1 frase.',
      'Não crie descontos novos: use apenas o que existe no settings.',
    ];
  } else if (st === 'objecoes') {
    stageRules = [
      'Responda a dúvida/objeção de forma objetiva e convide para finalizar o pedido.',
    ];
  } else if (st === 'fechamento') {
    stageRules = [
      'Finalize com o link do checkout e lembre (de forma curta) sobre pagamento na entrega.',
    ];
  } else if (st === 'posvenda') {
    stageRules = [
      'Agradeça o pagamento, informe acompanhamento da entrega e ofereça ajuda no uso.',
    ];
  }

  // Dicas dinâmicas (se o settings vier)
  const DYNAMIC_HINTS = [];
  if (price) DYNAMIC_HINTS.push(`Preço do settings: R$ ${price} (não invente outros valores).`);
  if (link)  DYNAMIC_HINTS.push(`Link oficial do checkout/site: ${link} (use apenas este).`);

  // (Opcional) Você pode injetar alguns itens do FAQ como contexto curto
  // Ex.: primeiras 2 Q&As mais comuns. Aqui mantemos enxuto para não poluir o prompt.

  const system = [...COMMON_RULES, ...stageRules, ...DYNAMIC_HINTS].join(' ');
  return { system, user };
}

export default { buildPrompt };
