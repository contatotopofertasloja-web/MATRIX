// src/adapters/whatsapp/index.js
const DRIVER = (process.env.WPP_ADAPTER || 'baileys').toLowerCase();

let driver;
if (DRIVER === 'meta') {
  driver = await import('./meta/index.js').then(m => m.default || m);
} else {
  driver = await import('./baileys/index.js').then(m => m.default || m);
}

export const init = driver.init;
export const onMessage = driver.onMessage;
export const sendMessage = driver.sendMessage;
export const stop = driver.stop;

export function whichAdapter() { return DRIVER; }
export default { init, onMessage, sendMessage, stop, whichAdapter };
