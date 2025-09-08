// configs/bots/claudia/prompts/index.js
// Builder de prompt por etapa (greet, qualify, offer, close, postsale)
// — recomenda APENAS 1 produto.

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

/** Monta o prompt para o LLM por etapa. */
export function buildPrompt({ stage = 'greet', message = '', settings = {}, extra = {} } = {}) {
  const { system, ctx } = buildBaseContext({ userMessage: message, stage, settings, extra });

  const hairType = detectHairType(message);
  const concerns = detectConcerns(message);
  const product = pickOneProduct({ hairType, concerns });

  let user = message?.toString()?.trim() || '';
  let recommendation = '';

  if (stage === 'offer' && product) {
    recommendation = formatRecommendation(product); // "Nome — motivo (uso: ...)"
  }

  return {
    system: `${system}\n\n${stageHeader(stage)}`,
    user: user || 'Início de conversa.',
    ctx: {
      ...ctx,
      hairType,
      concerns,
      product,
      recommendation,
    },
  };
}

export default { buildPrompt };
