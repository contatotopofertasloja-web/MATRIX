// configs/bots/maria/flow/greet.js
// Abertura objetiva, coleta de nome e tipo de cabelo (memória).

import { getState, setState } from './_state.js';

function extractName(msg = '') {
  const m1 = msg.match(/\b(meu\s+nome\s+é|sou|me\s+chamo)\s+([A-Za-zÀ-ÿ][\wÀ-ÿ'-]{1,})/i);
  if (m1) return m1[2];
  const oneWord = msg.trim().split(/\s+/);
  if (oneWord.length === 1 && oneWord[0].length >= 2 && /^[A-Za-zÀ-ÿ'-]+$/.test(oneWord[0])) {
    return oneWord[0];
  }
  return null;
}

export default async function greet({ userId, text, settings }) {
  const price = settings?.product?.price_target ?? settings?.product?.promo_price ?? 150;
  const st = getState(userId);
  const msg = String(text || '');

  // Tenta capturar o nome, se ainda não temos
  if (!st.name) {
    const name = extractName(msg);
    if (name) setState(userId, { name });
  }

  // Tenta capturar tipo de cabelo se responder direto
  if (!st.hair) {
    if (/liso/i.test(msg)) setState(userId, { hair: 'liso' });
    else if (/ondulad[ao]/i.test(msg)) setState(userId, { hair: 'ondulado' });
    else if (/cachead[ao]/i.test(msg)) setState(userId, { hair: 'cacheado' });
    else if (/crespo/i.test(msg)) setState(userId, { hair: 'crespo' });
  }

  const namePart = getState(userId).name ? ` ${getState(userId).name}` : '';
  if (!getState(userId).name) {
    return `Oi! 💖 Sou a Maria. Pra te atender certinho, como você prefere que eu te chame?`;
  }

  if (!getState(userId).hair) {
    return `Ótimo${namePart}! Me diz rapidinho: seu cabelo é liso, ondulado, cacheado ou crespo?`;
  }

  // Já tenho nome + tipo → avança com a oferta curta
  return [
    `Perfeito${namePart}!`,
    `Hoje tenho autorização pra vender **5 unidades** no valor promocional de **R$ ${price}** (de R$ 197).`,
    `Tenho interesse seu para garantir esse valor agora?`
  ].join(' ');
}
