// src/adapters/whatsapp/index.js
// Wrapper para expor uma factory por sessão em cima do adapter Baileys atual.

import baileyMod from './baileys/index.js';

const instances = new Map();

export function makeAdapter(opts = {}) {
  const session = opts.session || opts.SESSION || process.env.WPP_SESSION || 'claudia-main';
  if (!instances.has(session)) instances.set(session, createInstance(session));
  return instances.get(session);
}

export const whichAdapter = () => 'baileys';
export default { makeAdapter, whichAdapter };

function createInstance(session) {
  const impl = (typeof baileyMod === 'function')
    ? baileyMod
    : (baileyMod?.default ?? baileyMod);

  if (typeof impl === 'function') {
    return impl({ session });
  }

  let started = false;

  async function ensureStarted() {
    if (!started && typeof impl.init === 'function') {
      await impl.init({ session });
      started = true;
    }
  }

  async function onMessage(handler) {
    await ensureStarted();
    if (typeof impl.onMessage === 'function') {
      return impl.onMessage(handler);
    }
    if (typeof impl.setOnMessage === 'function') {
      return impl.setOnMessage(handler);
    }
    throw new Error('Adapter WhatsApp não expõe onMessage/setOnMessage');
  }

  return {
    onMessage,
    async sendMessage(to, text) {
      await ensureStarted();
      return impl.sendMessage?.(to, text);
    },
    async sendImage(to, imageUrl, caption = '') {
      await ensureStarted();
      return impl.sendImage?.(to, imageUrl, caption);
    },
    async isReady() {
      await ensureStarted();
      return impl.isReady?.();
    },
    async getQrDataURL() {
      await ensureStarted();
      return impl.getQrDataURL?.();
    },
    async stop() {
      return impl.stop?.();
    },
  };
}
