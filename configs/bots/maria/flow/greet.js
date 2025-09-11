// configs/bots/maria/flow/greet.js
// Etapa: recepção. Pergunta inicial sobre o tipo de cabelo.

import { settings } from '../../../../src/core/settings.js';

export const id = 'greet';
export const stage = 'recepcao';

export function match(text = '') {
  const t = String(text).toLowerCase();
  return (
    t === '' ||
    ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hello', 'hi'].some(x => t.includes(x))
  );
}

export async function run(ctx = {}) {
  const persona = settings?.persona_name || 'Maria';
  const opener =
    settings?.messages?.opening?.[0] ||
    `Oi! Eu sou a ${persona} 😊 Como é seu cabelo: liso, ondulado, cacheado ou crespo?`;
  return { text: opener, nextStage: 'qualificacao' };
}

export default { id, stage, match, run };
