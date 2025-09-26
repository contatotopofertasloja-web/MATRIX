// src/adapters/whatsapp/index.js
// Ponte do WhatsApp: expõe init/isReady/QR e repassa a API do Baileys adapter.
// + logs de init/disconnect para debug

import * as baileys from './baileys/index.js';

let _ready = false;
let _lastQrDataURL = null;

export async function init(opts = {}) {
  const { onQr } = opts || {};
  console.log("[wpp/init] iniciando adapter");
  await baileys.init({
    onReady: () => {
      _ready = true; _lastQrDataURL = null;
      console.log("[wpp/init] pronto e pareado");
    },
    onQr: async (dataURL) => {
      _lastQrDataURL = dataURL || null;
      console.log("[wpp/init] QR atualizado");
      if (typeof onQr === 'function') onQr(_lastQrDataURL);
    },
    onDisconnect: (reason) => {
      _ready = false;
      console.warn("[wpp/init] desconectado:", reason);
    },
  });
}

export function isReady() { return _ready; }

export async function getQrDataURL() {
  if (_ready) return null;
  return _lastQrDataURL || await baileys.getQrDataURL();
}

export async function forceNewQr() {
  _lastQrDataURL = null;
  console.log("[wpp/init] forçando novo QR");
  return await baileys.forceRefreshQr();
}

export async function logoutAndReset() {
  _ready = false; _lastQrDataURL = null;
  console.warn("[wpp/init] logout + reset solicitado");
  await baileys.logoutAndReset();
  return true;
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

export default { init, isReady, getQrDataURL, forceNewQr, logoutAndReset, adapter };
