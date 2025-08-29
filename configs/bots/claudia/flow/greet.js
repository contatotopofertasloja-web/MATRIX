// configs/bots/claudia/flow/greet.js
import { settings } from '../../../src/core/settings.js';

export async function greet() {
  const name = settings?.persona?.display_name || 'Cláudia';
  return [
    `Oi! Eu sou a ${name} 😊`,
    'Posso te ajudar a alinhar o cabelo sem formol.',
    'Seu cabelo é liso, ondulado, cacheado ou crespo?'
  ].join(' ');
}
