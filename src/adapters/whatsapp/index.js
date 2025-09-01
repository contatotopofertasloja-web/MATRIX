// src/adapters/whatsapp/index.js
// Seleciona o adapter de WhatsApp via ENV e expõe uma interface única.
// Requer: "type": "module" no package.json (ESM) e Node 18+.

const NAME = String(process.env.WPP_ADAPTER || 'baileys').toLowerCase();

let impl;

if (NAME === 'baileys') {
  // Adapter Baileys (QR Code)
  // Caminho relativo ao próprio diretório
  const mod = await import('./baileys/index.js');

  // padroniza a interface exportada
  impl = {
    adapter: mod.adapter,         // { onMessage(fn), sendMessage(to, text), sendImage(...) }
    isReady: mod.isReady,         // () => boolean
    getQrDataURL: mod.getQrDataURL, // () => dataURL | null
    init: mod.init,               // () => Promise<void>
    stop: mod.stop,               // () => Promise<void>
  };
} else if (NAME === 'meta' || NAME === 'cloudapi') {
  // Espaço reservado para o adapter da Cloud API do WhatsApp (futuro)
  throw new Error('Adapter "meta/cloudapi" ainda não implementado neste serviço.');
} else {
  throw new Error(`WPP_ADAPTER desconhecido: ${NAME}`);
}

// Reexports usados pelo servidor HTTP (src/index.js)
export const adapter = impl.adapter;
export const isReady = impl.isReady;
export const getQrDataURL = impl.getQrDataURL;
export const init = impl.init;
export const stop = impl.stop;

// (Opcional) export default para compat com imports antigos
export default { adapter, isReady, getQrDataURL, init, stop };
