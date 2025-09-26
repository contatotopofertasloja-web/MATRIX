// configs/bots/maria/flow/offer.js
// Confirma interesse, guarda sinal e pede CEP primeiro (disponibilidade por região).

import { getState, setState } from './_state.js';

export function match(text = '') {
  const t = String(text).toLowerCase();
  return /\b(preco|preço|valor|oferta|promo|quero|tenho\s*interesse|sim|ok|vamos|bora)\b/i.test(t);
}

export default async function offer({ userId, text, settings }) {
  const st = getState(userId);
  const name = st.name ? ` ${st.name}` : '';
  const price = settings?.product?.price_target ?? settings?.product?.promo_price ?? 150;

  // Se a pessoa respondeu "sim/ok/quero" marcamos interesse
  if (/\b(sim|quero|pode|ok|vamos|bora|tenho\s*interesse)\b/i.test(String(text))) {
    setState(userId, { interested: true });
  }

  // Se ainda não temos nome (chegou direto aqui), peça de forma objetiva
  if (!st.name) {
    return `Pra eu te atender certinho, como você prefere que eu te chame?`;
  }

  // Pergunta dados de forma fracionada: começamos pelo CEP (disponibilidade)
  if (!st.cep) {
    return `Perfeito${name}! 🙌 Antes de finalizar, me envia seu **CEP** pra eu confirmar a disponibilidade na sua região?`;
  }

  // Se já tem CEP mas faltam dados, encaminha para fechamento
  return [
    `Legal${name}! Promo de **R$ ${price}** garantida.`,
    `Me passa seu **endereço completo** (rua, número, bairro e cidade) para eu reservar?`,
    `Lembro: o pagamento é **na entrega (COD)**.`
  ].join(' ');
}
