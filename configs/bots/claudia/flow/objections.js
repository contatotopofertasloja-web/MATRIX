// configs/bots/claudia/flow/objections.js
// Responde objeções de preço, dano/química, tempo de uso e resultado esperado.
// Fala em valor (custo por aplicação/dia), COD, garantia e sorteio do mês.

import { setAwaitingConsent } from './_state.js';

const RX = {
  preco: /\b(caro|carinha|car[íi]ssimo|muito\s*car[oa]|pre[çc]o|valor|t[aá]\s*caro|caro\s*né)\b/i,
  dano:  /\b(estraga|danifica|cair\s*o?\s*cabelo|queda|quebra|ressec(a|ado)|alergia|dermatite|qu[ií]mica|formol|ard[eê])\b/i,
  tempo: /\b(demorad[oa]|demora|quanto\s*tempo|leva\s*tempo|n[aã]o\s*sei\s*usar|sou\s*iniciante|pregui[cç]a)\b/i,
  efeito:/\b(n[aã]o\s*alisa|n[aã]o\s*pega|fica\s*duro|n[aã]o\s*funciona|resultado)\b/i,
};

function bucketize(price = 170) {
  const usos = 3.5;              // média 3–4 aplicações
  const porAplic = price / usos;  // ~ R$48
  const dias = 60;                // durabilidade conservadora
  const porDia = price / dias;    // ~ R$2,83
  return { usos, porAplic, porDia };
}

export default {
  id: 'objections',
  stage: 'objections',

  match(text = '') {
    const t = String(text || '');
    return RX.preco.test(t) || RX.dano.test(t) || RX.tempo.test(t) || RX.efeito.test(t);
  },

  async run(ctx = {}) {
    const { jid, settings = {}, send } = ctx;
    const p = settings?.product || {};
    const price = Number(p?.price_target ?? 170);
    const teaserSorteio = settings?.sweepstakes?.enabled
      ? (settings?.messages?.sweepstakes_teaser || 'Fechando hoje você ainda entra no sorteio do mês 🎁')
      : '';

    const { porAplic, porDia } = bucketize(price);
    const cod  = settings?.messages?.cod_short || 'Pagamento na entrega (COD).';
    const grt  = settings?.messages?.guarantee_short || 'Garantia de 7 dias após a entrega.';

    const t = String(ctx.text || '');

    // 1) Preço/valor
    if (RX.preco.test(t)) {
      const pitch =
`Entendo! No salão sai *R$250–R$450* por sessão. No frasco, sai ~*R$${porAplic.toFixed(0)} por aplicação* (3–4 usos) e ~*R$${porDia.toFixed(2)} por dia*. 
Você faz em casa, no seu horário. ${cod} ${grt} ${teaserSorteio}
Quer que eu segure *R$${price}* e já te envie o link?`;
      setAwaitingConsent(jid, true);
      await send(jid, pitch);
      return;
    }

    // 2) Medo de dano/química
    if (RX.dano.test(t)) {
      const pitch =
`Entendo a sua preocupação 💛 A proposta aqui é *alisar/alinha* e *reduzir volume* cuidando dos fios, com modo de uso simples (40 min e pronto).
Resultados reais vêm do *passo a passo correto* e do *tempo de ação* indicado. ${cod} ${grt} ${teaserSorteio}
Se quiser, eu te guio no primeiro uso. Posso te enviar o link mantendo *R$${price}*?`;
      setAwaitingConsent(jid, true);
      await send(jid, pitch);
      return;
    }

    // 3) Tempo/esforço
    if (RX.tempo.test(t)) {
      const how = (settings?.product?.how_to_use || 'Lave, aplique, deixe agir ~40min e enxágue; finalize se quiser.').trim();
      const pitch =
`Dá pra fazer no seu tempo, em casa 😉 ${how}
Economiza idas ao salão e mantém o cabelo *alinhado e com brilho* por semanas. ${cod} ${grt} ${teaserSorteio}
Seguro *R$${price}* e te mando o link?`;
      setAwaitingConsent(jid, true);
      await send(jid, pitch);
      return;
    }

    // 4) Resultado esperado (não alisa, não pega, etc.)
    if (RX.efeito.test(t)) {
      const pitch =
`O foco é *alisar/alinhar* e *controlar o frizz*, reduzindo volume gradualmente a cada aplicação.
Se quiser bem liso, te explico como potencializar o resultado no primeiro uso. ${cod} ${grt} ${teaserSorteio}
Posso te enviar o link com *R$${price}* garantido?`;
      setAwaitingConsent(jid, true);
      await send(jid, pitch);
      return;
    }
  }
};
