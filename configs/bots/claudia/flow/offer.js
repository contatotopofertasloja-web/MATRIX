// configs/bots/claudia/flow/offer.js
// OFFER — informa preço do settings + benefício curto + COD; link só se pedir

function stripAccents(s=''){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function clean(t=''){return stripAccents(String(t||'').toLowerCase()).replace(/\s+/g,' ').trim();}
const RX = {
  askPrice:/\b(preco|preço|quanto\s*custa|valor|desconto|promo(cao|ção)|oferta)\b/i,
  askLink:/\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho)\b/i
};
const pick = arr => Array.isArray(arr)&&arr.length? arr[Math.floor(Math.random()*arr.length)] : '';

export default {
  id:'offer',
  stage:'oferta',

  match(text=''){
    const t=clean(text);
    return RX.askPrice.test(t) || RX.askLink.test(t);
  },

  async run(ctx={}){
    const { jid, text='', settings={}, send } = ctx;
    const t=clean(text);
    const p=settings?.product||{};
    const price = typeof p?.price_target==='number' ? p.price_target : p?.price_original;
    const checkout = p?.checkout_link;
    const hook = pick(p?.value_props)||'alinha os fios e controla o frizz de forma prática';
    const cod = settings?.messages?.cod_short || 'Pagamento na entrega (COD), sem risco.';

    // Pedido explícito de link
    if(RX.askLink.test(t) && checkout){
      await send(jid, `Perfeito! Aqui está o link seguro do checkout:\n${checkout}`);
      return;
    }

    // Só preço + construção de valor (1 frase) e depois pergunta
    await send(jid, `Consigo por *R$${price}* hoje — *${hook}*. ${cod} Posso te enviar o link seguro do checkout?`);
  }
};
