// Oferta com aquecimento, âncora 197→170, COD, garantia, sorteio.
// Só envia link se pedirem explicitamente ou após consentimento.
// Usa getCheckoutLink/getTargetPrice para garantir o link e preço.
import { setAwaitingConsent, canOfferNow, getCheckoutLink, getTargetPrice, shouldShowTeaser, markTeaserShown } from './_state.js';

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

  match(text=''){ 
    const t=clean(text); 
    return RX.askPrice.test(t) || RX.askLink.test(t) || RX.priceObjection.test(t);
  },

  async run(ctx={}) {
    const { jid, text='', settings={}, send } = ctx;
    const t = clean(text);
    const p = settings?.product || {};
    const priceOriginal = Number(p?.price_original ?? 197);
    const priceTarget   = Number(getTargetPrice(settings));           // robusto
    const checkout      = getCheckoutLink(settings);                  // robusto
    const hook = pick(p?.value_props) || 'alisa/alinhar, reduz volume e controla frizz com brilho saudável';
    const cod  = settings?.messages?.cod_short || 'Pagamento na entrega (COD), sem risco.';
    const grt  = settings?.messages?.guarantee_short || 'Garantia de 7 dias após a entrega.';
    const sold = settings?.marketing?.sold_count || 40000;

    const teaser =
      settings?.sweepstakes?.enabled && shouldShowTeaser(jid)
        ? (settings?.messages?.sweepstakes_teaser || 'Comprando este mês você concorre a 3 prêmios 🎁')
        : '';

    // Pedido direto de link
    if (RX.askLink.test(t) && checkout) {
      setAwaitingConsent(jid, false);
      await send(jid, `Perfeito! Link seguro do checkout:\n${checkout}\nDepois o entregador chama no WhatsApp. ${cod}`);
      return;
    }

    // Objeção de preço → reforça valor antes de repetir preço
    if (RX.priceObjection.test(t)) {
      await send(jid, `Entendo! A ideia é *economizar salão* e ter resultado em casa: ${hook}. Já são *${sold.toLocaleString('pt-BR')}* frascos vendidos. Hoje consigo *R$${priceTarget}* (${cod} ${grt}). Quer o link pra conferir?`);
      setAwaitingConsent(jid, true);
      return;
    }

    // Perguntou preço → âncora + valor
    if (RX.askPrice.test(t)) {
      if (teaser) markTeaserShown(jid);
      await send(jid, `Normalmente é *R$${priceOriginal}*, mas hoje consigo *R$${priceTarget}*. ${hook}. ${cod} ${grt} ${teaser}\nTe envio o link?`);
      setAwaitingConsent(jid, true);
      return;
    }

    // Sem pergunta de preço → aquece sem revelar
    if (!canOfferNow(jid)) {
      await send(jid, `Ela ${hook}. Quer que eu te explique rapidinho *como usar* e as *condições*?`);
      setAwaitingConsent(jid, true);
      return;
    }

    // Pode ofertar → revela
    if (teaser) markTeaserShown(jid);
    await send(jid, `Hoje sai de *R$${priceOriginal}* por *R$${priceTarget}*. ${hook}. ${cod} ${grt} ${teaser}\nQuer o link do checkout?`);
    setAwaitingConsent(jid, true);
  }
};
