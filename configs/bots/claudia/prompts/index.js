// configs/bots/claudia/prompts/index.js
// Builder de prompt por etapa (greet, qualify, offer, close, postsale)
// — ajustado para recomendar APENAS 1 produto.

// Base (tom/guardrails) + catálogo (ranking de 1 produto)
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

/**
 * Monta o prompt para o LLM, por etapa.
 * Compatível com o uso no src/index.js:
 *   const { system, user } = buildPrompt({ stage, message })
 */
export function buildPrompt({ stage = 'greet', message = '', settings = {}, extra = {} } = {}) {
  const { system, ctx } = buildBaseContext({ userMessage: message, stage, settings, extra });

  // Heurística leve para a etapa "offer": tenta pré-computar 1 produto.
  let preface = stageHeader(stage);
  if (stage === 'offer') {
    const hairType = detectHairType(message);
    const concerns = detectConcerns(message);
    const picked = pickOneProduct({ hairType, concerns });
    if (picked) {
      const rec = formatRecommendation(picked); // "Nome — motivo (uso: ...)"
      preface += `\nSugestão interna (não citar que é heurística): ${rec}`;
    }
    preface += `\nInstrução: recomende apenas 1 produto e explique o porquê em UMA frase.`;
  }

  const user = `${preface}\n\nUsuário: ${message}`.trim();
  return { system, user, ctx };
}

export default { buildPrompt };
