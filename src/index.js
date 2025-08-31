// src/adapters/whatsapp/index.js
// Factory de adaptadores WhatsApp (multi-sessão)
// - makeAdapter({ session, device, authDir, outboxTopic })
// - expõe: onMessage, sendMessage, sendImage, isReady, getQrDataURL

const DRIVER = (process.env.WPP_ADAPTER || 'baileys').toLowerCase();

// cache por sessão para evitar reinit
const instances = new Map();

/**
 * Cria (ou retorna do cache) um adaptador para a sessão informada.
 * Por padrão usa o driver "baileys" do seu projeto.
 */
export function makeAdapter({
  session,
  device,
  authDir,
  outboxTopic,
} = {}) {
  if (!session) throw new Error('makeAdapter: informe { session }');

  // já existe? devolve
  if (instances.has(session)) return instances.get(session);

  const api = buildAdapterForSession({ session, device, authDir, outboxTopic });
  instances.set(session, api);
  return api;
}

function buildAdapterForSession({ session, device, authDir, outboxTopic }) {
  // Defaults amigáveis
  const AUTH_DIR = authDir || process.env.WPP_AUTH_DIR || '/app/baileys-auth-v2';
  const DEVICE   = device   || process.env.WPP_DEVICE   || `Matrix-${session}`;
  const TOPIC    = outboxTopic || process.env.OUTBOX_TOPIC || `outbox:${session}`;

  // Usamos import dinâmico com um query param único por sessão
  // para forçar o Node a instanciar o módulo novamente.
  const moduleUrl =
    DRIVER === 'baileys'
      ? `./baileys/index.js?session=${encodeURIComponent(session)}`
      : `./meta/index.js?session=${encodeURIComponent(session)}`;

  // Guardamos o estado do módulo carregado aqui
  let modPromise = null;

  async function ensureModule() {
    if (modPromise) return modPromise;

    // ⚠️ Importante: set ENVs específicas desta sessão ANTES do import
    const prev = {
      WPP_SESSION: process.env.WPP_SESSION,
      WPP_DEVICE:  process.env.WPP_DEVICE,
      WPP_AUTH_DIR: process.env.WPP_AUTH_DIR,
      OUTBOX_TOPIC: process.env.OUTBOX_TOPIC,
    };

    process.env.WPP_SESSION  = session;
    process.env.WPP_DEVICE   = DEVICE;
    process.env.WPP_AUTH_DIR = AUTH_DIR;
    process.env.OUTBOX_TOPIC = TOPIC;

    // Carrega o driver (baileys/meta) com cache key diferente por sessão
    modPromise = import(moduleUrl).then(async (m) => {
      const mod = m.default || m;

      // Alguns dos seus drivers expõem init(); se existir, inicializa já
      if (typeof mod.init === 'function') {
        await mod.init();
      }

      // Restaura ENVs globais (para não “vazar” para outras sessões)
      process.env.WPP_SESSION  = prev.WPP_SESSION  ?? '';
      process.env.WPP_DEVICE   = prev.WPP_DEVICE   ?? '';
      process.env.WPP_AUTH_DIR = prev.WPP_AUTH_DIR ?? '';
      process.env.OUTBOX_TOPIC = prev.OUTBOX_TOPIC ?? '';

      return mod;
    });

    return modPromise;
  }

  // API que o resto da Matrix enxerga
  return {
    async onMessage(fn) {
      const mod = await ensureModule();
      // compat: alguns drivers usam onMessage, outros adapter.onMessage
      const target = mod.onMessage || mod.adapter?.onMessage;
      if (typeof target !== 'function') {
        throw new Error(`[${session}] driver não expõe onMessage`);
      }
      return target.call(mod, fn);
    },

    async sendMessage(to, text, opts = {}) {
      const mod = await ensureModule();
      const fn = mod.sendMessage || mod.adapter?.sendMessage;
      if (typeof fn !== 'function') throw new Error(`[${session}] driver não expõe sendMessage`);
      return fn.call(mod, to, text, opts);
    },

    async sendImage(to, imageUrl, caption = '') {
      const mod = await ensureModule();
      const fn = mod.sendImage || mod.adapter?.sendImage;
      if (typeof fn !== 'function') throw new Error(`[${session}] driver não expõe sendImage`);
      return fn.call(mod, to, imageUrl, caption);
    },

    async isReady() {
      const mod = await ensureModule();
      const fn = mod.isReady || mod.adapter?.isReady;
      return typeof fn === 'function' ? !!(await fn.call(mod)) : false;
    },

    async getQrDataURL() {
      const mod = await ensureModule();
      const fn = mod.getQrDataURL || mod.adapter?.getQrDataURL;
      if (typeof fn !== 'function') return null;
      return await fn.call(mod);
    },
  };
}

export default { makeAdapter };
