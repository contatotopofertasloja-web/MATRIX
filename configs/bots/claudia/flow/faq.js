// FAQ baseado em YAML — inclui sorteio/regulamento. Só envia link do regulamento quando o cliente pede.
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

export default {
  id: 'faq',
  stage: 'faq',

  match(text='') {
    const t = String(text || '');
    return compiled.some(c => c.triggers.some(rx => rx.test(t)));
  },

  async run(ctx = {}) {
    const { jid, text = '', settings = {}, send } = ctx;
    const t = String(text || '');
    const ctxVars = { ...settings, product: settings?.product || {}, messages: settings?.messages || {}, sweepstakes: settings?.sweepstakes || {} };

    for (const c of compiled) {
      if (!c.triggers.some(rx => rx.test(t))) continue;

      // sub-triggers (ex.: juros?)
      for (const sub of Object.values(c.subs || {})) {
        if (sub.triggers.some(rx => rx.test(t))) {
          await send(jid, render(pick(sub.answers), ctxVars));
          return;
        }
      }

      // regra: só libera link do regulamento quando pedirem (categoria sweepstakes_rules)
      if (c.key === 'sweepstakes_rules') {
        const msg = render(pick(c.answers), ctxVars);
        await send(jid, msg);
        return;
      }

      // demais FAQs sem links extras (só texto)
      const answer = render(pick(c.answers), ctxVars);
      await send(jid, answer);
      return;
    }
  }
};
