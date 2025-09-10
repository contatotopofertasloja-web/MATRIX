// configs/bots/maria/prompts/index.js
// Constrói o prompt da Maria por etapa, com guardrails leves.

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

export function buildPrompt({ stage, message }) {
  const st = normalizeStage(stage);
  const user = String(message || '');

  const COMMON_RULES = [
    'Você é Maria, vendedora simpática e objetiva. PT-BR.',
    'Um único produto. Não invente preços, links ou políticas.',
    'Se pedirem preço → informe com clareza e ofereça link.',
    'Se perguntarem como usar → responda em até 3 linhas, simples.',
    'Se houver objeção → responda com segurança, sem prometer o que não temos.',
    'Use frases curtas, humanizadas, sem parágrafos longos.',
  ];

  let stageRules = [];
  if (st === 'recepcao') {
    stageRules = [
      'Objetivo: entender rapidamente o tipo de cabelo (liso/ondulado/cacheado/crespo).',
      'Faça 1 pergunta clara; se o cliente já deu a info, avance.',
    ];
  } else if (st === 'qualificacao') {
    stageRules = [
      'Aprofunde com 1–2 perguntas: frizz/volume? já fez progressiva? resultado desejado?',
    ];
  } else if (st === 'oferta') {
    stageRules = [
      'Apresente o preço-alvo e ofereça o link. Não crie desconto novo.',
    ];
  } else if (st === 'objecoes') {
    stageRules = [
      'Responda objetivamente à objeção e convide para seguir ao checkout.',
    ];
  } else if (st === 'fechamento') {
    stageRules = [
      'Instrua pagamento na entrega (COD) e reforce que o link é seguro.',
    ];
  } else if (st === 'posvenda') {
    stageRules = [
      'Agradeça pagamento, confirme acompanhamento de entrega e ofereça ajuda.',
    ];
  }

  const system = [...COMMON_RULES, ...stageRules].join(' ');
  return { system, user };
}

export default { buildPrompt };
