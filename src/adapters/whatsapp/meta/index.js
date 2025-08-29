let _onMsgCb = null;

export async function init() {
  console.log('[WPP/meta] init');
  // TODO: inicializar Webhook/Long-polling da Cloud API
}

export function onMessage(cb) { _onMsgCb = cb; }

export async function sendMessage(to, text, opts = {}) {
  console.log('[WPP/meta] sendMessage ->', { to, text, opts });
  // TODO: POST /messages (Cloud API)
  return { ok: true };
}

export async function stop() {
  console.log('[WPP/meta] stop');
}

export default { init, onMessage, sendMessage, stop };
