// src/adapters/whatsapp/index.js
// Ponte do WhatsApp: expõe init/isReady/QR e repassa a API do Baileys adapter.
// Mantém compat com o que já integramos no index do app.

import * as baileys from './baileys/index.js';

let _ready = false;
let _lastQrDataURL = null;

export async function init(opts = {}) {
  const { onQr } = opts || {};
  await baileys.init({
    onReady: () => { _ready = true; _lastQrDataURL = null; },
    onQr: async (dataURL) => {
      _lastQrDataURL = dataURL || null;
      if (typeof onQr === 'function') onQr(_lastQrDataURL);
    },
    onDisconnect: () => { _ready = false; },
  });
}

export function isReady() { return _ready; }

export async function getQrDataURL() {
  if (_ready) return null;                  // já pareado
  return _lastQrDataURL || await baileys.getQrDataURL();
}

// Força um novo QR quando app ainda não está pareado
export async function forceNewQr() {
  _lastQrDataURL = null;
  const ok = await baileys.forceRefreshQr();
  return ok;
}

// Logout + reset total de sessão (para sessão corrompida)
export async function logoutAndReset() {
  _ready = false;
  _lastQrDataURL = null;
  await baileys.logoutAndReset();
  return true;
}

// Espelha a API do adapter
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

export default { init, isReady, getQrDataURL, forceNewQr, logoutAndReset, adapter };
