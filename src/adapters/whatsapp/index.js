// src/adapters/whatsapp/index.js
// Seleciona o driver via WPP_ADAPTER (baileys | meta) — default: baileys
const DRIVER = (process.env.WPP_ADAPTER || 'baileys').toLowerCase();

let driver;
if (DRIVER === 'meta') {
  driver = await import('./meta/index.js').then(m => m.default || m);
} else {
  driver = await import('./baileys/index.js').then(m => m.default || m);
}

// Interface exposta para o server (src/index.js)
export const adapter = {
  init:        driver.init,
  onMessage:   driver.onMessage,
  sendMessage: driver.sendMessage,
  stop:        driver.stop,
};

export const isReady      = driver.isReady;
export const getQrDataURL = driver.getQrDataURL;

export function whichAdapter() { return DRIVER; }
export default { adapter, isReady, getQrDataURL, whichAdapter };
