// configs/bots/maria/flow/greet.js
// Greet da Maria — simples, sem “assistente virtual”, agora com memória persistente (core/memory).

import { recall, remember } from '../../../../src/core/memory.js';

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
  const msg = String(text || '');
  const st = await recall(userId);

  // Nome
  if (!st.name) {
    const name = extractName(msg);
    if (name) await remember(userId, { name });
  }

  // Tipo de cabelo
  if (!st.hair) {
    if (/liso/i.test(msg))        await remember(userId, { hair: 'liso' });
    else if (/ondulad[ao]/i.test(msg)) await remember(userId, { hair: 'ondulado' });
    else if (/cachead[ao]/i.test(msg)) await remember(userId, { hair: 'cacheado' });
    else if (/crespo/i.test(msg))      await remember(userId, { hair: 'crespo' });
  }

  const cur = await recall(userId);
  const namePart = cur.name ? ` ${cur.name}` : '';

  if (!cur.name) {
    return `Oi! 💖 Sou a Maria. Pra te atender certinho, como você prefere que eu te chame?`;
  }

  if (!cur.hair) {
    return `Ótimo${namePart}! Me diz rapidinho: seu cabelo é liso, ondulado, cacheado ou crespo?`;
  }

  // Já tenho nome + tipo → oferta curta
  return [
    `Perfeito${namePart}!`,
    `Hoje tenho autorização pra vender **5 unidades** no valor promocional de **R$ ${price}** (de R$ 197).`,
    `Tem interesse pra eu garantir esse valor agora?`
  ].join(' ');
}
