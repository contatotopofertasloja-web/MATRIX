// CLOSE — envia o link quando pedem ou quando há consentimento

import { isAwaitingConsent, clearConsent } from './_state.js';

function stripAccents(s=''){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function clean(t=''){return stripAccents(String(t||'').toLowerCase()).replace(/\s+/g,' ').trim();}

const YES = /\b(sim|pode|pode\s*sim|quero|manda|envia|ok|fechar|fechamento|finaliza(r)?|fechar|link|checkout|comprar)\b/i;

export default {
  id: 'close',
  stage: 'fechamento',

  match(text=''){ return YES.test(clean(text)); },

  async run(ctx = {}) {
    const { jid, text='', settings = {}, send } = ctx;
    const p = settings?.product || {};
    const checkout = p?.checkout_link;
    const t = clean(text);

    // só envia se pediu link OU deu consentimento após oferta
    if (!checkout) return;

    if (YES.test(t) || isAwaitingConsent(jid)) {
      clearConsent(jid);
      const lines = [
        `Link de checkout: ${checkout}`,
        `Use para confirmar o endereço. Depois, o entregador chama no WhatsApp para combinar a entrega.`,
        `Pagamento na entrega (COD) e garantia de 7 dias após receber.`,
        `Quando finalizar, me avise aqui com o comprovante de agendamento/entrega que libero seu cupom de fidelidade.`
      ];
      await send(jid, lines.join('\n'));
    }
  }
};
