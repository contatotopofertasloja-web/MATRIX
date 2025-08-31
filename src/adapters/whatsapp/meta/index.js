// src/adapters/whatsapp/meta/index.js
let _onMsgCb = null;
let _ready = false;

export function isReady() { return _ready; }
export async function getQrDataURL() { return null; }
export function onMessage(cb) { _onMsgCb = typeof cb === 'function' ? cb : null; }

export async function init() {
  _ready = true; // stub “conectado”
  console.log('[WPP/meta] Stub iniciado (sem Cloud API). Use WPP_ADAPTER=baileys por enquanto.');
}

export async function sendMessage(_to, _text) {
  throw new Error('Adapter Meta (Cloud API) ainda não implementado.');
}

export async function stop() { _ready = false; }

export default { init, onMessage, sendMessage, stop, isReady, getQrDataURL };
