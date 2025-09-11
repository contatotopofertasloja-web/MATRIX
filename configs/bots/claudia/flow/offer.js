// configs/bots/claudia/flow/offer.js
// OFFER — apresenta preço e pergunta se pode enviar link.
// Só envia link se o cliente pedir explicitamente (link/checkout/comprar/finalizar).

function stripAccents(s = '') {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function clean(text = '') {
  return stripAccents(String(text || '').toLowerCase()).replace(/\s+/g, ' ').trim();
}

const RX = {
  askPrice: /\b(preco|preço|quanto\s*custa|valor|promo(cao|ção)|desconto|oferta)\b/i,
  askLink:  /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho)\b/i
};

export default {
  id: 'offer',
  stage: 'oferta',

  match(text = '') {
    const t = clean(text);
    return RX.askPrice.test(t) || RX.askLink.test(t);
  },

  async run(ctx = {}) {
    const { jid, text = '', settings = {}, send } = ctx;
    const t = clean(text);
    const p = settings?.product || {};
    const price = typeof p?.price_target === 'number' ? p.price_target : p?.price_original;
    const checkout = p?.checkout_link;

    // Se o cliente PEDIU link/checkout/comprar → envia link direto
    if (RX.askLink.test(t) && checkout) {
      await send(jid, `Perfeito! Aqui está o link seguro do checkout (pagamento na entrega – COD):\n${checkout}`);
      return;
    }

    // Caso apenas tenha perguntado preço/valor → informa e pergunta permissão
    const linhas = [
      `Consigo para você por **R$${price}** hoje.`,
      `Te envio o link seguro do checkout?`
    ];
    await send(jid, linhas.join(' '));
  }
};
