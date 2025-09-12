// OFFER — oferta persuasiva + teaser do sorteio (sem link do regulamento aqui)

import { setAwaitingConsent, canOfferNow } from './_state.js';

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

  match(text=''){ const t=clean(text); return RX.askPrice.test(t) || RX.askLink.test(t); },

  async run(ctx={}){
    const { jid, text='', settings={}, send } = ctx;
    const t=clean(text);
    const p=settings?.product||{};
    const price = typeof p?.price_target==='number' ? p.price_target : p?.price_original;
    const checkout = p?.checkout_link;
    const hook = pick(p?.value_props)||'alinha os fios e controla o frizz de forma prática';
    const cod  = settings?.messages?.cod_short || 'Pagamento na entrega (COD), sem risco.';
    const grt  = settings?.messages?.guarantee_short || 'Garantia de 7 dias após a entrega.';
    const teaser = settings?.sweepstakes?.enabled
      ? (settings?.messages?.sweepstakes_teaser || 'Comprando este mês você concorre a 3 prêmios.')
      : '';

    if(RX.askLink.test(t) && checkout){
      setAwaitingConsent(jid, false);
      await send(jid, `Perfeito! Aqui está o link do checkout (preencher endereço). Depois o entregador chama no WhatsApp. ${cod}\n${checkout}`);
      return;
    }

    if(!canOfferNow(jid)) {
      await send(jid, `Consigo manter *R$${price}* hoje. ${cod} ${grt} ${teaser} Quer que eu te envie o link do checkout?`);
      setAwaitingConsent(jid, true);
      return;
    }

    await send(jid, `Hoje sai de R$${p.price_original} por *R$${price}*. ${hook}. ${cod} ${grt} ${teaser} Quer que eu te envie o link do checkout?`);
    setAwaitingConsent(jid, true);
  }
};
