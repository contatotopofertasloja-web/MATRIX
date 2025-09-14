// src/adapters/whatsapp/index.js
// Seleciona o adapter de WhatsApp via ENV e expõe interface unificada.

const NAME = String(process.env.WPP_ADAPTER || 'baileys').toLowerCase();

let impl;

if (NAME === 'baileys') {
  const mod = await import('./baileys/index.js');
  impl = {
    adapter: mod.adapter,
    isReady: mod.isReady,
    getQrDataURL: mod.getQrDataURL,
    init: mod.init,
    stop: mod.stop,
  };
} else if (NAME === 'meta' || NAME === 'cloudapi') {
  throw new Error('Adapter "meta/cloudapi" ainda não implementado.');
} else {
  throw new Error(`WPP_ADAPTER desconhecido: ${NAME}`);
}

export const adapter = impl.adapter;
export const isReady = impl.isReady;
export const getQrDataURL = impl.getQrDataURL;
export const init = impl.init;
export const stop = impl.stop;

export default { adapter, isReady, getQrDataURL, init, stop };
