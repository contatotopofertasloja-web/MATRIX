// Oferta com aquecimento, ancora 197→170, COD, garantia, sorteio; só dá link sob pedido/consentimento
import { setAwaitingConsent, canOfferNow } from './_state.js';

function stripAccents(s=''){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function clean(t=''){return stripAccents(String(t||'').toLowerCase()).replace(/\s+/g,' ').trim();}
const RX = {
  askPrice:/\b(preco|preço|quanto\s*custa|valor|desconto|promo(cao|ção)|oferta)\b/i,
  askLink:/\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho)\b/i,
  priceObjection:/\b(caro|preco\s*alto|preço\s*alto|muito\s*car[oa])\b/i,
};
const pick = arr => Array.isArray(arr)&&arr.length? arr[Math.floor(Math.random()*arr.length)] : '';

export default {
  id:'offer',
  stage:'oferta',

  match(text=''){ const t=clean(text); return RX.askPrice.test(t) || RX.askLink.test(t) || RX.priceObjection.test(t); },

  async run(ctx={}) {
    const { jid, text='', settings={}, send, userName } = ctx;
    const t=clean(text);
    const p=settings?.product||{};
    const priceOriginal = Number(p?.price_original ?? 197);
    const priceTarget   = Number(p?.price_target   ?? 170);
    const checkout = p?.checkout_link;
    const hook = pick(p?.value_props)||'alisa/alinhar os fios, reduz volume e controla o frizz com brilho saudável';
    const cod  = settings?.messages?.cod_short || 'Pagamento na entrega (COD), sem risco.';
    const grt  = settings?.messages?.guarantee_short || 'Garantia de 7 dias após a entrega.';
    const teaser = settings?.sweepstakes?.enabled
      ? (settings?.messages?.sweepstakes_teaser || 'Comprando este mês você concorre a 3 prêmios 🎁')
      : '';

    // pedido direto de link
    if(RX.askLink.test(t) && checkout){
      setAwaitingConsent(jid, false);
      await send(jid, `${userName?userName+', ':''}perfeito! Link seguro do checkout:\n${checkout}\nDepois o entregador chama no WhatsApp. ${cod}`);
      return;
    }

    // objeção de preço → valor antes de repetir preço
    if (RX.priceObjection.test(t)) {
      await send(jid, `Entendo! A ideia é *economizar salão* e ter resultado em casa: ${hook}. Hoje consigo *R$${priceTarget}* (${cod} ${grt}). Quer o link pra conferir?`);
      setAwaitingConsent(jid, true);
      return;
    }

    // perguntou preço → ancora + valor
    if (RX.askPrice.test(t)) {
      await send(jid, `Normalmente é *R$${priceOriginal}*, mas consigo *R$${priceTarget}* hoje. ${hook}. ${cod} ${grt} ${teaser}\n${userName?userName+', ':''}te envio o link?`);
      setAwaitingConsent(jid, true);
      return;
    }

    // sem pergunta de preço → aquece
    if (!canOfferNow(jid)) {
      await send(jid, `Ela ${hook}. Posso te explicar rapidinho *como usar* e *as condições*?`);
      setAwaitingConsent(jid, true);
      return;
    }

    // pode ofertar → revela
    await send(jid, `Hoje sai de *R$${priceOriginal}* por *R$${priceTarget}*. ${hook}. ${cod} ${grt} ${teaser}\n${userName?userName+', ':''}quer o link do checkout?`);
    setAwaitingConsent(jid, true);
  }
};
