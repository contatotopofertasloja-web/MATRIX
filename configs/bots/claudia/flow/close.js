// configs/bots/claudia/flow/close.js
// CLOSE — oportunidade no funil: manda o link direto.

function stripAccents(s = '') {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function clean(text = '') {
  return stripAccents(String(text || '').toLowerCase()).replace(/\s+/g, ' ').trim();
}

const RX = {
  close: /\b(checkout|finalizar|finaliza(r)?|fechar|fechamento|comprar|carrinho|manda\s*o\s*link)\b/i
};

export default {
  id: 'close',
  stage: 'fechamento',

  match(text = '') {
    return RX.close.test(clean(text));
  },

  async run(ctx = {}) {
    const { jid, settings = {}, send } = ctx;
    const p = settings?.product || {};
    const checkout = p?.checkout_link;

    if (checkout) {
      await send(jid, `Show! Segue o link seguro do checkout 👇 (pagamento na entrega – COD)\n${checkout}`);
    } else {
      await send(jid, `Posso gerar o link do checkout pra você agora.`);
    }
  }
};
