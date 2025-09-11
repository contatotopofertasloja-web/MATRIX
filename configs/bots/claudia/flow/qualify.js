// configs/bots/claudia/flow/qualify.js
// QUALIFY — capta contexto de cabelo/dor (sem link) + anti-loop por contato

const lastAsk = new Map(); // jid -> { askedAt: ms, key: 'liso_vs_alinhado' }

function stripAccents(s=''){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function clean(t=''){return stripAccents(String(t||'').toLowerCase()).replace(/\s+/g,' ').trim();}

const RX = {
  hairHints: /\b(liso|ondulado|cachead[oa]|crespo|frizz|volume|oleos[oa]|ressecad[oa]|quebradi[çc]o|queda|alinhamento|selagem|liso\s*natural)\b/i,
  productName: /\b(qual\s*o?\s*nome\s*(do|da)\s*produto|nome\s*(do|da)\s*produto|qual\s*produto|que\s*produto|nome\s*dele|qual\s*a\s*marca|marca\s*(do|da)\s*produto|marca\s*qual)\b/i
};

function canAsk(jid, key, cooldownMs=90000){
  const now=Date.now();
  const rec=lastAsk.get(jid);
  if(!rec||rec.key!==key||now-(rec.askedAt||0)>cooldownMs){ lastAsk.set(jid,{key,askedAt:now}); return true; }
  return false;
}

export default {
  id:'qualify',
  stage:'qualificacao',

  match(text=''){
    const t=clean(text);
    return RX.hairHints.test(t) || RX.productName.test(t);
  },

  async run(ctx={}){
    const { jid, text='', settings={}, send } = ctx;
    const t=clean(text);
    const product=settings?.product||{};
    const name=product?.name||'nosso produto';

    // 1) Nome/marca do produto (sem link)
    if(RX.productName.test(t)){
      await send(jid, `O nome do produto é *${name}*. Posso te orientar rapidinho pro seu tipo de cabelo?`);
      return;
    }

    // 2) Qualificação consultiva com anti-loop
    const key='liso_vs_alinhado';
    if(canAsk(jid,key,90000)){
      await send(jid, 'Seu cabelo é liso, ondulado, cacheado ou crespo?');
      await send(jid, 'Você busca deixar *bem liso* ou só *alinhado com brilho*?');
    } else {
      // já perguntado recentemente → faça avanço leve sem repetir
      await send(jid, 'Perfeito. Me diga se seu foco é *controlar frizz* ou *reduzir volume*, que eu te indico certinho.');
    }
  }
};
