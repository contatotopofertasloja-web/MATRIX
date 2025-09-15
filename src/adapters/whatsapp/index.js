// src/adapters/whatsapp/index.js
import * as baileys from './baileys/index.js';

let _ready = false;
let _lastQrDataURL = null;

export async function init(opts = {}) {
  const { onQr } = opts || {};
  await baileys.init({
    onReady: () => { _ready = true; },
    onQr: async (/*dataUrlFromAdapter*/) => {
      // O adapter expõe getQrDataURL(); aqui apenas lemos quando preciso
      const du = await baileys.getQrDataURL();
      _lastQrDataURL = du || null;
      if (typeof onQr === 'function') onQr(_lastQrDataURL);
    },
    onDisconnect: () => { _ready = false; },
  });
}

export function isReady() { return _ready; }
export async function getQrDataURL() {
  if (_ready) return null; // se já pareou, não exibe QR
  return _lastQrDataURL || await baileys.getQrDataURL();
}

export const adapter = {
  onMessage: baileys.adapter.onMessage,
  sendMessage: baileys.adapter.sendMessage,
  sendImage: baileys.adapter.sendImage,
  sendAudio: baileys.adapter.sendAudio,
  sendVoice: baileys.adapter.sendVoice,
  getAudioBuffer: baileys.adapter.getAudioBuffer,
  downloadMedia: baileys.adapter.downloadMedia,
  close: baileys.stop,
};

export default { init, isReady, getQrDataURL, adapter };
