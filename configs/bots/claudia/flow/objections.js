// respostas de valor: caro, dúvidas de custo, salão etc.

import { setAwaitingConsent } from './_state.js';

const YESNO = /\b(caro|carinha|caro\s*né|preco|preço|valor|carissimo|muito\s*caro|tá\s*caro|esta\s*caro)\b/i;

function bucketize(price = 170) {
  const usos = 3.5; // média 3–4 aplicações
  const porAplic = price / usos;           // ~ R$48
  const dias = 60;                         // durabilidade conservadora
  const porDia = price / dias;             // ~ R$2,83
  return { usos, porAplic, porDia };
}

export default {
  id: 'objections',
  stage: 'objections',
  match(text = '') { return YESNO.test(text || ''); },

  async run(ctx = {}) {
    const { jid, settings = {}, send } = ctx;
    const p = settings?.product || {};
    const price = p.price_target ?? 170;
    const { porAplic, porDia } = bucketize(price);

    const pitch = `Entendo! No salão sai *R$250–R$450* por sessão. No frasco, dá ~*R$${porAplic.toFixed(0)} por aplicação* (3–4 usos) e ~*R$${porDia.toFixed(2)} por dia*. Você aplica em casa, no seu horário, com pagamento *na entrega (COD)* e *garantia de 7 dias*. Quer que eu segure *R$${price}* e já te envie o link?`;

    setAwaitingConsent(jid, true);
    await send(jid, pitch);
  }
};
