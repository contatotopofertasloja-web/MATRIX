// Fechamento: envia link quando há consentimento/pedido, respeita plantão 06–21h.
// Sem perguntas depois do link (encerra limpo).
import { isAwaitingConsent, clearConsent, getCheckoutLink, isWithinBusinessHours } from './_state.js';

function stripAccents(s=''){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function clean(t=''){return stripAccents(String(t||'').toLowerCase()).replace(/\s+/g,' ').trim();}
const YES = /\b(sim|pode|pode\s*sim|quero|manda|envia|ok|fechar|finaliza(r)?|link|checkout|comprar)\b/i;

export default {
  id: 'close',
  stage: 'fechamento',

  match(text=''){ return YES.test(clean(text)); },

  async run(ctx = {}) {
    const { jid, text='', settings = {}, send, userName } = ctx;
    const checkout = getCheckoutLink(settings); // robusto; usa YAML, ENV ou fallback fixo
    if (!checkout) return;

    // Respeita janela de atendimento (default 06:00–21:00 BRT)
    if (!isWithinBusinessHours(settings)) {
      await send(jid, `Nosso plantão volta às *${settings?.business?.hours_start ?? '06:00'}* ⏰.\nDeixo o link aqui pra você confirmar quando quiser:\n${checkout}\nPagamento na entrega (COD).`);
      return;
    }

    if (isAwaitingConsent(jid) || YES.test(clean(text))) {
      clearConsent(jid);
      const teaser = settings?.sweepstakes?.enabled
        ? (settings?.messages?.sweepstakes_teaser || 'Confirmando hoje você já entra no sorteio do mês 🎁')
        : null;

      const lines = [
        `${userName?userName+', ':''}aqui está seu link seguro: ${checkout}`,
        `Preencha o endereço. O entregador chama no WhatsApp pra combinar a entrega 🚚`,
        `${settings?.messages?.cod_short || 'Pagamento na entrega (COD).'} ${settings?.messages?.guarantee_short || 'Garantia de 7 dias após a entrega.'}`,
        teaser
      ].filter(Boolean);

      await send(jid, lines.join('\n'));
      // Nada de perguntas depois do link — encerra limpo.
    }
  }
};
