// objections.js — respostas de valor: caro, dúvidas de custo, salão etc.

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

    const bullets = [
      `no salão, uma progressiva sai fácil por *R$250–R$450* por sessão`,
      `no frasco, sai em média *R$${porAplic.toFixed(0)} por aplicação* (3–4 usos)`,
      `diluindo no tempo, dá cerca de *R$${porDia.toFixed(2)} por dia* de cabelo alinhado`,
      `você aplica em casa, no seu horário, sem gastar com ida ao salão`,
      `pagamento só *na entrega (COD)* e *garantia de 7 dias* após receber`,
      `são *+40 mil* clientes satisfeitas no Brasil`,
    ];

    const pitch = `Entendo o ponto! Comparando com salão, o custo cai muito: ${bullets[1]} e cerca de ${bullets[2]}. Além disso, ${bullets[3]} — e ainda tem ${bullets[4]}. Quer que eu segure *R$${price}* pra você e já envio o link do checkout?`;

    // após objeção, já habilita consentimento para “sim/pode/manda”
    setAwaitingConsent(jid, true);
    await send(jid, pitch);
  }
};
