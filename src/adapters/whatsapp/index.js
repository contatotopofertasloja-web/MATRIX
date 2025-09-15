// Facade unificada p/ WhatsApp. Expõe:
// - adapter: { init, onMessage, sendMessage, sendImage, sendAudio|sendVoice, getAudioBuffer, downloadMedia, close }
// - isReady(): bool
// - getQrDataURL(): string (data:image/png;base64,...)

import * as baileys from './baileys.js';

let _ready = false;
let _lastQrDataURL = null;

export async function init(opts = {}) {
  const { onQr } = opts || {};
  await baileys.init({
    onReady: () => { _ready = true; },
    onQr: (dataUrl) => {
      _lastQrDataURL = dataUrl || null;
      if (typeof onQr === 'function') onQr(dataUrl);
    },
    onDisconnect: () => { _ready = false; },
  });
}

export function isReady() {
  return _ready;
}

export function getQrDataURL() {
  // retorna null se já está pareado
  return _ready ? null : _lastQrDataURL;
}

// Reexporta a interface do adapter
export const adapter = {
  onMessage: baileys.onMessage,
  sendMessage: baileys.sendMessage,
  sendImage: baileys.sendImage,
  sendAudio: baileys.sendAudio,     // p/ PTT (preferível) — index.js tenta ambos
  sendVoice: baileys.sendVoice,     // fallback
  getAudioBuffer: baileys.getAudioBuffer,
  downloadMedia: baileys.downloadMedia,
  close: baileys.stop,
};

export default { init, isReady, getQrDataURL, adapter };
