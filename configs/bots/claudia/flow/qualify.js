// configs/bots/claudia/flow/qualify.js
// Capta tipo de cabelo e objetivo, evita repetição (cooldown) e avança o funil.

const state = new Map(); // jid -> { hairType, goal, asked: { hair:ms, goal:ms } }

function stripAccents(s=''){ return s.normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function clean(t=''){ return stripAccents(String(t||'').toLowerCase()).replace(/\s+/g,' ').trim(); }

const RX = {
  hairType: /\b(liso|ondulado|cachead[oa]|crespo)\b/i,
  goal: /\b(bem\s*liso|alinhad[oa]\s*com\s*brilho|controlar\s*o?\s*frizz|reduzi?r?\s*volume)\b/i
};

function canAsk(askedAt = 0, cooldownMs = 90000) {
  return Date.now() - askedAt > cooldownMs;
}

export default {
  id: 'qualify',
  stage: 'qualificacao',

  match(text='') {
    const t = clean(text);
    return !!t; // qualquer texto que não foi pego por greet já passa aqui
  },

  async run(ctx = {}) {
    const { jid, text = '', send } = ctx;
    const t = clean(text);
    const s = state.get(jid) || { hairType: null, goal: null, asked: {} };

    // 1) Captura sinais
    if (RX.hairType.test(t)) s.hairType = (t.match(RX.hairType)||[])[0];
    if (RX.goal.test(t))     s.goal     = (t.match(RX.goal)||[])[0];

    // 2) Pergunta *apenas* o que falta, com cooldown (evita loop)
    if (!s.hairType) {
      if (canAsk(s.asked?.hair)) {
        s.asked.hair = Date.now();
        state.set(jid, s);
        await send(jid, 'Seu cabelo é *liso*, *ondulado*, *cacheado* ou *crespo*?');
        return;
      }
    }

    if (!s.goal) {
      if (canAsk(s.asked?.goal)) {
        s.asked.goal = Date.now();
        state.set(jid, s);
        await send(jid, 'Você busca deixar *bem liso* ou só *alinhado com brilho*? (Se preferir, posso focar em *controlar o frizz* ou *reduzir volume*)');
        return;
      }
    }

    // 3) Se já temos dados, avança: faz um resumo curto e deixa o OFFER seguir
    if (s.hairType || s.goal) {
      state.set(jid, s);
      const partes = [];
      if (s.hairType) partes.push(`cabelo *${s.hairType}*`);
      if (s.goal)     partes.push(`foco em *${s.goal}*`);
      await send(jid, `Entendi: ${partes.join(' + ')}. Se quiser, já te passo o *preço* e como funciona.`);
      return;
    }

    // fallback educado, sem repetir perguntas
    await send(jid, 'Perfeito! Se puder, me diga seu *tipo de cabelo* e seu *objetivo* (ex.: bem liso, controlar frizz, reduzir volume).');
  }
};
