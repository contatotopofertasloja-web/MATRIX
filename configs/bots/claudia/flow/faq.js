// configs/bots/claudia/flow/faq.js
// FAQ/Objeções — usa variações do settings.yaml (sem alucinar)

function stripAccents(s = '') {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function clean(text = '') {
  return stripAccents(String(text || '').toLowerCase()).replace(/\s+/g, ' ').trim();
}

function dotGet(obj, path, fallback = '') {
  return String(path).split('.').reduce((acc, k) => (acc && acc[k] != null ? acc[k] : null), obj) ?? fallback;
}

// Renderiza {{placeholders}} com dados do settings
function render(tpl = '', settings = {}) {
  return String(tpl).replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
    const k = String(key || '').trim();
    if (k.startsWith('product.')) return dotGet(settings?.product || {}, k.split('.').slice(1).join('.'), '');
    if (k.startsWith('delivery_sla.')) return dotGet(settings?.product?.delivery_sla || {}, k.split('.').slice(1).join('.'), '');
    if (k === 'price' || k === 'price_target') {
      const p = settings?.product || {};
      const val = typeof p?.price_target === 'number' ? p.price_target : p?.price_original;
      return val ?? '';
    }
    return dotGet(settings, k, '');
  });
}

function pickOne(list = []) {
  const arr = Array.isArray(list) ? list : [];
  if (!arr.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

export default {
  id: 'faq',
  stage: 'faq',

  // Match: verifica triggers de todas categorias configuradas no settings
  match(text = '', settings = {}) {
    const t = clean(text);
    const cats = settings?.faq?.categories || {};
    for (const key of Object.keys(cats)) {
      const triggers = cats[key]?.triggers || [];
      for (const patt of triggers) {
        if (!patt) continue;
        const rx = new RegExp(patt, 'i');
        if (rx.test(t)) return true;
      }
    }
    return false;
  },

  /**
   * run(ctx): seleciona categoria e responde com 1 frase curta (sem link por padrão)
   * @param {Object} ctx
   * @param {string} ctx.jid
   * @param {string} ctx.text
   * @param {Object} ctx.settings
   * @param {Function} ctx.send
   */
  async run(ctx = {}) {
    const { jid, text = '', settings = {}, send } = ctx;
    const t = clean(text);
    const cats = settings?.faq?.categories || {};

    // acha a primeira categoria cujo trigger bate
    let chosen = null;
    for (const key of Object.keys(cats)) {
      const triggers = cats[key]?.triggers || [];
      if (triggers.some((p) => new RegExp(p, 'i').test(t))) {
        chosen = cats[key];
        break;
      }
    }

    if (!chosen) {
      // fallback curto
      await send(jid, 'Claro! Posso te ajudar com prazo, pagamento, modo de uso ou segurança do produto. Qual tema você prefere?');
      return;
    }

    const ans = pickOne(chosen.answers);
    const textOut = render(ans, settings).trim();
    if (textOut) {
      await send(jid, textOut);
      return;
    }

    await send(jid, 'Perfeito! Posso detalhar isso pra você. Quer saber sobre prazo, pagamento ou como usar?');
  }
};
