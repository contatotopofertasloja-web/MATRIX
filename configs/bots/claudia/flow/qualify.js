// configs/bots/claudia/flow/qualify.js
// QUALIFY — captura contexto de cabelo e dúvidas simples (sem link automático)

function stripAccents(s = '') {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function clean(text = '') {
  return stripAccents(String(text || '').toLowerCase()).replace(/\s+/g, ' ').trim();
}

const RX = {
  hairHints: /\b(liso|ondulado|cachead[oa]|crespo|frizz|volume|oleos[oa]|ressecad[oa]|quebradi[çc]o|queda|alinhamento|selagem|liso\s*natural)\b/i,
  productName: /\b(qual\s*o?\s*nome\s*(do|da)\s*produto|nome\s*(do|da)\s*produto|qual\s*produto|que\s*produto|nome\s*dele|qual\s*a\s*marca|marca\s*(do|da)\s*produto|marca\s*qual)\b/i
};

export default {
  id: 'qualify',
  stage: 'qualificacao',

  match(text = '') {
    const t = clean(text);
    // evita engolir intents de preço/fechamento (router já prioriza offer/close)
    return RX.hairHints.test(t) || RX.productName.test(t);
  },

  async run(ctx = {}) {
    const { jid, text = '', settings = {}, send } = ctx;
    const t = clean(text);
    const product = settings?.product || {};
    const name = product?.name || 'nosso produto';

    // Perguntas sobre nome/marca → responde sem link
    if (RX.productName.test(t)) {
      await send(jid, `O nome do produto é **${name}** ✨ Posso te explicar rapidinho como funciona e indicar a melhor opção pro seu cabelo?`);
      return;
    }

    // Qualificação “clássica”: mapeia tipo/dor e prepara para a oferta
    const perguntas = [
      'Entendi! Pra eu te indicar certinho: seu cabelo é liso, ondulado, cacheado ou crespo?',
      'Você busca deixar **bem liso** ou só **alinhado com brilho**?'
    ];
    const msgs = RX.hairHints.test(t) ? perguntas.slice(1) : perguntas;
    for (const m of msgs) await send(jid, m);
  }
};
