// [MATRIX_STAMP:whatsapp v2.0] src/adapters/whatsapp/index.js
// Ponte única p/ WhatsApp. Hoje só Baileys; Meta pode ser plugado aqui.
// Exporta: init, isReady, getQrDataURL, adapter (sendMessage/sendImage/onMessage)

const ADAPTER = String(process.env.WPP_ADAPTER || 'baileys').toLowerCase();

let impl = null;
if (ADAPTER === 'baileys') {
  impl = await import('./baileys/index.js');
} else {
  // fallback (no futuro: meta cloud)
  impl = await import('./baileys/index.js');
}

export const init = impl.init || (async ()=>{ /* no-op */ });
export const isReady = impl.isReady || (() => false);
export const getQrDataURL = impl.getQrDataURL || (async () => null);
export const adapter = impl.adapter || {
  onMessage() {},
  async sendMessage(){ throw new Error('adapter not ready'); },
  async sendImage(){ throw new Error('adapter not ready'); },
};
export default { init, isReady, getQrDataURL, adapter };
