// src/adapters/whatsapp/index.js
// Seleciona o adapter via ENV e expõe named exports usados pelo core.

const NAME = String(process.env.WPP_ADAPTER || 'baileys').toLowerCase();

async function loadImpl() {
  if (NAME === 'baileys') {
    const mod = await import('./baileys/index.js');

    const adapter = mod.adapter;
    const isReady = mod.isReady;
    const getQrDataURL = mod.getQrDataURL;

    if (typeof adapter !== 'object' || typeof adapter.onMessage !== 'function') {
      throw new Error('[wpp/index] Adapter inválido: precisa expor .onMessage/.sendMessage/.sendImage');
    }
    if (typeof isReady !== 'function')      throw new Error('[wpp/index] isReady ausente');
    if (typeof getQrDataURL !== 'function') throw new Error('[wpp/index] getQrDataURL ausente');

    const init = typeof mod.init === 'function' ? mod.init : async () => {};
    const stop = typeof mod.stop === 'function' ? mod.stop : async () => {};

    return { adapter, isReady, getQrDataURL, init, stop };
  }

  if (NAME === 'meta' || NAME === 'cloudapi') {
    throw new Error('[wpp/index] Adapter "meta/cloudapi" ainda não implementado. Use WPP_ADAPTER=baileys.');
  }

  throw new Error(`[wpp/index] WPP_ADAPTER desconhecido: "${NAME}"`);
}

const impl = await loadImpl();
export const adapter = impl.adapter;
export const isReady = impl.isReady;
export const getQrDataURL = impl.getQrDataURL;
export const init = impl.init;
export const stop = impl.stop;

export default { adapter, isReady, getQrDataURL, init, stop };
