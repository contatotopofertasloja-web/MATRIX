// src/adapters/whatsapp/index.js
// Seleciona o adapter via ENV e expõe *named exports* que o src/index.js usa.
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

// *Named exports* esperados por src/index.js
export const adapter = impl.adapter;
export const isReady = impl.isReady;
export const getQrDataURL = impl.getQrDataURL;
export const init = impl.init;
export const stop = impl.stop;

// Default para compat com imports antigos (se existirem)
export default { adapter, isReady, getQrDataURL, init, stop };
