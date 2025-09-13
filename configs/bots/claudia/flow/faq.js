// FAQ via YAML + fallbacks: parcelamento 12x, empresa, promo/sorteio,
// horário 6–21h, áudio IN/OUT, e rendimento até 10 aplicações.
import faq from '../faq.yaml' assert { type: 'yaml' };

function get(obj, path) {
  return String(path || '').split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
}
function render(tpl, ctx) {
  return String(tpl || '').replace(/{{\s*([^}]+)\s*}}/g, (_, p) => {
    const v = get(ctx, p.trim());
    return v == null ? '' : String(v);
  });
}
function pick(arr) { return Array.isArray(arr) && arr.length ? arr[Math.floor(Math.random()*arr.length)] : ''; }
function re(rx) { return new RegExp(rx, 'i'); }

const compiled = Object.entries(faq?.categories || {}).map(([key, def]) => {
  const triggers = (def.triggers || []).map(re);
  const answers = def.answers || [];
  const subs = {};
  if (def.sub_triggers) {
    for (const [subKey, subDef] of Object.entries(def.sub_triggers)) {
      subs[subKey] = { triggers: (subDef.triggers || []).map(re), answers: subDef.answers || [] };
    }
  }
  return { key, triggers, answers, subs };
});

// Fallbacks críticos (se o YAML não cobrir)
const fallbackRules = [
  {
    key: 'parcelamento',
    triggers: /(parcel|parcela|em\s*quantas\s*vezes|12x|cart[aã]o)/i,
    answer: (ctx) => {
      const price = Number(ctx?.product?.price_target ?? 170);
      const parcela = Math.round((price / 12) * 100) / 100;
      return `Temos parcelamento no cartão em até *12x de R$ ${parcela.toFixed(2)}*. Se preferir, tem *Pagamento na Entrega (COD)*.`;
    },
  },
  {
    key: 'empresa',
    triggers: /(empresa|voc[eê]\s*trabalha|quem\s*são|sobre\s*n[óo]s|topofertas)/i,
    answer: () => 'Eu sou a Cláudia, da *TopOfertas*. A gente testa e seleciona produtos com melhor custo–benefício e entrega rápida. Posso ajudar com mais alguma dúvida?',
  },
  {
    key: 'promocao',
    triggers: /(promo[cç][aã]o|desconto\s*extra|cupom)/i,
    answer: (ctx) => {
      const cupom = ctx?.product?.coupon_code;
      return cupom
        ? `Hoje temos condição especial. Se preferir, aplico o cupom *${cupom}* pra você. Quer garantir agora?`
        : 'Estamos com condição especial hoje. Quer que eu te passe as *condições* e como funciona?';
    },
  },
  {
    key: 'sorteio',
    triggers: /(sorteio|brinde|concorrer|pr[eê]mio)/i,
    answer: (ctx) => {
      if (ctx?.sweepstakes?.enabled) {
        return ctx?.messages?.sweepstakes_teaser || 'Comprando este mês você concorre a *3 prêmios*. Quando quiser, te passo os detalhes.';
      }
      return 'No momento, não temos sorteio ativo, mas a condição de hoje está bem vantajosa. Posso te explicar rapidinho?';
    },
  },
  {
    key: 'horario',
    triggers: /(hor[aá]rio|atendimento|que\s*horas|funciona\s*de)/i,
    answer: (ctx) => {
      const h1 = ctx?.business?.hours_start ?? '06:00';
      const h2 = ctx?.business?.hours_end ?? '21:00';
      return `Nosso atendimento funciona em *plantão*, das *${h1} às ${h2}*. Me chama à vontade nesse horário.`;
    },
  },
  {
    key: 'audio',
    triggers: /(audio|áudio|mandar\s*um\s*áudio|responde\s*áudio)/i,
    answer: (ctx) => {
      const canIn  = !!(ctx?.flags?.allow_audio_in ?? true);
      const canOut = !!(ctx?.flags?.allow_audio_out ?? true);
      if (canIn && canOut) return 'Pode mandar *áudio* sim 😊 Eu escuto e também posso te responder em *áudio* se preferir.';
      if (canIn)          return 'Pode mandar *áudio* sim 😊 Eu escuto e te respondo por aqui.';
      return 'No momento respondo por texto, mas posso te ajudar com qualquer dúvida rapidinho 😉';
    },
  },
  {
    key: 'rendimento',
    triggers: /(rende|quantas\s*aplica(c|ç)[oõ]es|quanto\s*dura\s*o\s*frasco)/i,
    answer: () => 'O frasco rende *de 3 até 10 aplicações*, variando pelo volume e comprimento do cabelo. A duração média do alinhamento fica em torno de *2–3 meses* com os cuidados certos.',
  },
];

export default {
  id: 'faq',
  stage: 'faq',

  match(text='') {
    const t = String(text || '');
    if (compiled.some(c => c.triggers.some(rx => rx.test(t)))) return true;
    return fallbackRules.some(r => r.triggers.test(t));
  },

  async run(ctx = {}) {
    const { jid, text = '', settings = {}, send, userName } = ctx;
    const t = String(text || '');
    const ctxVars = { ...settings, product: settings?.product || {}, messages: settings?.messages || {}, sweepstakes: settings?.sweepstakes || {}, business: settings?.business || {}, flags: settings?.flags || {} };

    // 1) YAML (com sub-triggers)
    for (const c of compiled) {
      if (!c.triggers.some(rx => rx.test(t))) continue;
      for (const sub of Object.values(c.subs || {})) {
        if (sub.triggers.some(rx => rx.test(t))) {
          await send(jid, render(pick(sub.answers), ctxVars));
          return;
        }
      }
      const answer = render(pick(c.answers), ctxVars);
      const prefix = userName ? `${userName}, ` : '';
      await send(jid, `${prefix}${answer}`);
      return;
    }

    // 2) Fallbacks críticos
    const fb = fallbackRules.find(r => r.triggers.test(t));
    if (fb) {
      const msg = typeof fb.answer === 'function' ? fb.answer(ctxVars) : String(fb.answer || '');
      if (msg) await send(jid, msg);
    }
  }
};
