// configs/bots/maria/flow/offer.js
// Confirma interesse, guarda sinal e pede CEP (disponibilidade por região) — memória persistente.

import { recall, remember } from '../../../../src/core/memory.js';

export function match(text = '') {
  const t = String(text || '');
  return /\b(preco|preço|valor|oferta|promo|quero|tenho\s*interesse|sim|ok|vamos|bora)\b/i.test(t);
}

export default async function offer({ userId, text, settings }) {
  const price = settings?.product?.price_target ?? settings?.product?.promo_price ?? 150;
  const st = await recall(userId);

  // Marca interesse se houver sinal
  if (/\b(sim|quero|pode|ok|vamos|bora|tenho\s*interesse)\b/i.test(String(text))) {
    await remember(userId, { interested: true });
  }

  if (!st?.name) {
    return `Pra eu te atender certinho, como você prefere que eu te chame?`;
  }

  if (!st?.cep) {
    return `Perfeito ${st.name}! 🙌 Antes de finalizar, me envia seu **CEP** pra eu confirmar a disponibilidade na sua região?`;
  }

  // Já tem CEP → pede endereço completo
  return [
    `Legal ${st.name}! Promo de **R$ ${price}** garantida.`,
    `Me passa seu **endereço completo** (rua, número, bairro e cidade) para eu reservar?`,
    `Lembro: o pagamento é **na entrega (COD)**.`
  ].join(' ');
}
