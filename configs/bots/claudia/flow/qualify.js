// Capta tipo de cabelo e objetivo (alisar/reduzir volume/frizz), gera conexão e prepara oferta
const state = new Map(); // jid -> { hairType, goal, asked }

function stripAccents(s=''){ return s.normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function clean(t=''){ return stripAccents(String(t||'').toLowerCase()).replace(/\s+/g,' ').trim(); }

const RX = {
  hairType: /\b(liso|ondulado|cachead[oa]|crespo)\b/i,
  goal: /\b(bem\s*liso|alisar|alinhad[oa]\s*com\s*brilho|controlar\s*frizz|reduzi?r?\s*volume)\b/i,
  askTypes: /(para\s*qual\s*tipo.*serve|qual\s*tipo\s*de\s*cabelo\s*serve|tipos\s*de\s*cabelo)/i,
};

function canAsk(askedAt = 0, cooldownMs = 90000) {
  return Date.now() - askedAt > cooldownMs;
}

export default {
  id: 'qualify',
  stage: 'qualificacao',

  match(text='') { return !!clean(text); },

  async run(ctx = {}) {
    const { jid, text = '', send, userName } = ctx;
    const t = clean(text);
    const s = state.get(jid) || { hairType: null, goal: null, asked: {} };

    if (RX.askTypes.test(t)) {
      await send(jid, 'Serve para *todos os tipos*: liso, ondulado, cacheado e crespo. O foco principal é *alisar/alinhar* e *reduzir volume*, controlando o frizz e dando brilho. Como é o seu?');
      return;
    }

    if (RX.hairType.test(t)) s.hairType = (t.match(RX.hairType)||[])[0];
    if (RX.goal.test(t))     s.goal     = (t.match(RX.goal)||[])[0];

    if (!s.hairType && canAsk(s.asked?.hair)) {
      s.asked.hair = Date.now();
      state.set(jid, s);
      await send(jid, `${userName?userName+', ':''}seu cabelo é *liso*, *ondulado*, *cacheado* ou *crespo*?`);
      return;
    }

    if (!s.goal && canAsk(s.asked?.goal)) {
      s.asked.goal = Date.now();
      state.set(jid, s);
      await send(jid, `E qual é seu maior incômodo: *frizz*, *volume* ou quer deixar *bem liso/alinhado com brilho*?`);
      return;
    }

    if (s.hairType || s.goal) {
      state.set(jid, s);
      const partes = [];
      if (s.hairType) partes.push(`cabelo *${s.hairType}*`);
      if (s.goal)     partes.push(`foco em *${s.goal}*`);
      await send(jid, `Show! Entendi: ${partes.join(' + ')}. Posso te explicar *como funciona* e a *condição de hoje*?`);
      return;
    }

    await send(jid, 'Me conta rapidinho: seu *tipo de cabelo* e o *objetivo* (alisar, reduzir volume, controlar frizz).');
  }
};
