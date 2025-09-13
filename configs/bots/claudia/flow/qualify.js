// QUALIFY — capta tipo de cabelo e objetivo, salva no perfil e prepara oferta
import { setUserProfile, getUserProfile, shouldAsk } from './_state.js';

function stripAccents(s=''){ return s.normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function clean(t=''){ return stripAccents(String(t||'').toLowerCase()).replace(/\s+/g,' ').trim(); }

const RX = {
  hairType: /\b(liso|ondulado|cachead[oa]|crespo)\b/i,
  goal: /\b(bem\s*liso|alisar|alinhad[oa]\s*com\s*brilho|controlar\s*frizz|reduzi?r?\s*volume)\b/i,
  askTypes: /(para\s*qual\s*tipo.*serve|qual\s*tipo\s*de\s*cabelo\s*serve|tipos\s*de\s*cabelo)/i,
  myName: /\b(meu\s+nome\s+é|pode\s+me\s+chamar\s+de|sou\s+a|sou\s+o)\s+([a-zá-úãõç]+)\b/i,
};

export default {
  id: 'qualify',
  stage: 'qualificacao',

  match(text='') { return !!clean(text); },

  async run(ctx = {}) {
    const { jid, text = '', send } = ctx;
    const t = clean(text);
    const prof = getUserProfile(jid);

    // Captura e grava o nome quando a pessoa diz "meu nome é…"
    const m = RX.myName.exec(text);
    if (m && m[2]) {
      const nome = m[2].replace(/[^A-Za-zÀ-ÿ' -]/g,'');
      setUserProfile(jid, { name: nome });
      await send(jid, `Prazer, ${nome}! 💛`);
      return;
    }

    if (RX.askTypes.test(t)) {
      await send(jid, 'Serve para *todos os tipos*: liso, ondulado, cacheado e crespo. O foco principal é *alisar/alinhar* e *reduzir volume*, controlando o frizz e dando brilho. Como é o seu?');
      return;
    }

    const next = { ...prof };
    const h = text.match(RX.hairType)?.[0];
    const g = text.match(RX.goal)?.[0];
    if (h) next.hairType = h.toLowerCase();
    if (g) next.goal = g.toLowerCase();
    if (h || g) setUserProfile(jid, next);

    const namePrefix = next.name ? `${next.name}, ` : '';

    if (!next.hairType && shouldAsk(jid, 'hair')) {
      await send(jid, `${namePrefix}seu cabelo é *liso*, *ondulado*, *cacheado* ou *crespo*?`);
      return;
    }
    if (!next.goal && shouldAsk(jid, 'goal')) {
      await send(jid, `E qual é seu maior incômodo: *frizz*, *volume* ou quer deixar *bem liso/alinhado com brilho*?`);
      return;
    }

    if (next.hairType || next.goal) {
      const partes = [];
      if (next.hairType) partes.push(`cabelo *${next.hairType}*`);
      if (next.goal)     partes.push(`foco em *${next.goal}*`);
      await send(jid, `Show! Entendi: ${partes.join(' + ')}. Posso te explicar *como funciona* e a *condição de hoje*?`);
      return;
    }

    await send(jid, 'Me conta rapidinho: seu *tipo de cabelo* e o *objetivo* (alisar, reduzir volume, controlar frizz).');
  }
};
