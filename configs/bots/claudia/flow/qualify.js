// Capta tipo de cabelo e objetivo, evita repetição e avança o funil.

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
    return !!t;
  },

  async run(ctx = {}) {
    const { jid, text = '', send } = ctx;
    const t = clean(text);
    const s = state.get(jid) || { hairType: null, goal: null, asked: {} };

    if (RX.hairType.test(t)) s.hairType = (t.match(RX.hairType)||[])[0];
    if (RX.goal.test(t))     s.goal     = (t.match(RX.goal)||[])[0];

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
        await send(jid, 'Você busca deixar *bem liso* ou *alinhado com brilho*? (Posso focar em *controlar frizz* ou *reduzir volume*)');
        return;
      }
    }

    if (s.hairType || s.goal) {
      state.set(jid, s);
      const partes = [];
      if (s.hairType) partes.push(`cabelo *${s.hairType}*`);
      if (s.goal)     partes.push(`foco em *${s.goal}*`);
      await send(jid, `Entendi: ${partes.join(' + ')}. Posso te passar o *preço* e como funciona?`);
      return;
    }

    await send(jid, 'Perfeito! Se puder, me diga seu *tipo de cabelo* e seu *objetivo* (ex.: bem liso, controlar frizz, reduzir volume).');
  }
};
