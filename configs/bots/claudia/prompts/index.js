// configs/bots/claudia/prompts/index.js
import { buildBaseContext } from '../../../src/core/prompts/base.js';
import { pickOneProduct, formatRecommendation } from '../../../src/core/prompts/product.js';

function detectHairType(text) {
  const t = String(text || '').toLowerCase();
  if (/\bcrespo\b/.test(t)) return 'crespo';
  if (/\bcachead[oa]\b/.test(t)) return 'cacheado';
  if (/\bondulad[oa]\b/.test(t)) return 'ondulado';
  if (/\blis[oa]\b/.test(t)) return 'liso';
  return '';
}

function detectConcerns(text) {
  const t = String(text || '').toLowerCase();
  const concerns = [];
  if (/\bfrizz\b/.test(t)) concerns.push('frizz');
  if (/\b(ressecad[oa]|ressecamento)\b/.test(t)) concerns.push('ressecamento');
  if (/\bantiqueda\b|\bqueda\b/.test(t)) concerns.push('queda');
  if (/\bdefini(ç|c)ao|\bdefinir\b/.test(t)) concerns.push('definicao');
  if (/\bchapinha\b|\bsecador\b|\bterm(ico|al)\b/.test(t)) concerns.push('termo');
  if (/\bquebra\b/.test(t)) concerns.push('quebra');
  return concerns;
}

function stageHeader(stage) {
  switch (stage) {
    case 'greet':    return 'Etapa: saudação e início do diagnóstico.';
    case 'qualify':  return 'Etapa: diagnóstico objetivo do cabelo.';
    case 'offer':    return 'Etapa: recomendação de 1 produto (apenas um).';
    case 'close':    return 'Etapa: fechamento com modo de uso curto.';
    case 'postsale': return 'Etapa: pós-venda e reforço de uso.';
    default:         return 'Etapa: conversa.';
  }
}

export function buildPrompt({ stage = 'greet', message = '', settings = {}, extra = {} } = {}) {
  const { system, ctx } = buildBaseContext({ userMessage: message, stage, settings, extra });

  const hairType = detectHairType(message);
  const concerns = detectConcerns(message);
  const product = pickOneProduct({ hairType, concerns });

  const user = message?.toString()?.trim() || '';
  const recommendation = stage === 'offer' && product ? formatRecommendation(product) : '';

  return {
    system: `${system}\n\n${stageHeader(stage)}`,
    user: user || 'Início de conversa.',
    ctx: { ...ctx, hairType, concerns, product, recommendation },
  };
}

export default { buildPrompt };
