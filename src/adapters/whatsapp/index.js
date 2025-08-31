// src/adapters/whatsapp/index.js
// Wrapper para expor uma factory por sessão em cima do adapter Baileys atual.

import baileyMod from './baileys/index.js';

const instances = new Map();

// Export principal esperado pelo src/index.js
export function makeAdapter(opts = {}) {
  const session = opts.session || opts.SESSION || process.env.WPP_SESSION || 'claudia-main';
  if (!instances.has(session)) instances.set(session, createInstance(session));
  return instances.get(session);
}

// Compat extra (opcional): informar quem é o adapter atual
export const whichAdapter = () => 'baileys';

// Default export só para conveniência (não é usado pelo index.js)
export default { makeAdapter, whichAdapter };

// --------------------------- helpers ---------------------------

function createInstance(session) {
  // O seu baileyMod pode ser um objeto (default) com métodos
  // ou (em outros cenários) uma função factory. Tratamos os dois.
  const impl = (typeof baileyMod === 'function')
    ? baileyMod                              // já é uma factory -> delega
    : (baileyMod?.default ?? baileyMod);     // objeto com métodos

  if (typeof impl === 'function') {
    // Caso o arquivo ./baileys/index.js exporte uma factory,
    // apenas chamamos passando a sessão.
    return impl({ session });
  }

  // Caso comum: é um objeto com init/onMessage/sendMessage/...
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
      // se seu impl tiver stop() nós repassamos
      return impl.stop?.();
    },
  };
}
