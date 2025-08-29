// src/adapters/whatsapp/index.js
// Seleciona o driver via WPP_ADAPTER = 'baileys' | 'meta' (default: baileys)
const DRIVER = (process.env.WPP_ADAPTER || 'baileys').toLowerCase();

let lib;
if (DRIVER === 'meta') {
  lib = await import('./meta/index.js');
} else {
  lib = await import('./baileys/index.js');
}

// Reexporta as funções esperadas
export const onMessage = lib.onMessage;
export const sendMessage = lib.sendMessage;
export const sendImage = lib.sendImage;

// Exports usados pelo server
export const isReady = lib.isReady;
export const getQrDataURL = lib.getQrDataURL;

// Exporta o objeto adapter (o src/index.js importa isso)
export const adapter = {
  onMessage,
  sendMessage,
  sendImage,
};

// Helper opcional p/ debug
export function whichAdapter() {
  return DRIVER;
}

export default { adapter, onMessage, sendMessage, sendImage, isReady, getQrDataURL, whichAdapter };
