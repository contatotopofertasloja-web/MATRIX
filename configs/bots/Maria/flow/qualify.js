// configs/bots/maria/flow/qualify.js
// Etapa: qualificação. Aprofunda 1–2 perguntas.

import { settings } from '../../../../src/core/settings.js';

export const id = 'qualify';
export const stage = 'qualificacao';

export function match(text = '') {
  const t = String(text).toLowerCase();
  // Se o cliente já respondeu algo sobre cabelo, frizz/volume, cai aqui:
  const hasHairType = /(liso|ondulado|cachead[oa]|crespo)/i.test(t);
  const askingPrice = /(preco|preço|valor|quanto custa|link|checkout)/i.test(t);
  return hasHairType && !askingPrice;
}

export async function run(ctx = {}) {
  const followups = settings?.messages?.qualify_followups || [
    'Você já fez progressiva antes? Te incomoda mais o frizz ou o volume?',
    'Prefere resultado bem liso ou só alinhado com brilho?',
  ];
  return { text: followups[0], nextStage: 'oferta' };
}

export default { id, stage, match, run };
