//scr/adapters/whastapp/baileys.js
// Implementação mínima; substitua pelos handlers reais quando quiser.
// Mantém a mesma interface { init, onMessage, sendMessage, stop }.
let _onMsgCb = null;

export async function init() {
  console.log('[WPP/baileys] init');
  // TODO: conectar Baileys aqui
}

export function onMessage(cb) { _onMsgCb = cb; }

export async function sendMessage(to, text, opts = {}) {
  console.log('[WPP/baileys] sendMessage ->', { to, text, opts });
  // TODO: enviar via Baileys
  return { ok: true };
}

export async function stop() {
  console.log('[WPP/baileys] stop');
  // TODO: fechar conexões
}

export default { init, onMessage, sendMessage, stop };
