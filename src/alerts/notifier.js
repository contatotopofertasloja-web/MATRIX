// src/alerts/notifier.js
import { sendAlertEmail } from './email.js';

// Vars já usadas no projeto — preservadas
const {
  ALERT_WEBHOOK_URL,
  PROJECT_NAME = 'Matrix',
  INSTANCE_ID = 'unknown',
} = process.env;

// opcional: throttle simples no webhook pra evitar spam (independente do e-mail)
const WEBHOOK_THROTTLE_MS = Number(process.env.ALERT_WEBHOOK_THROTTLE_MS || 60000);
const _lastWebhook = new Map();
const _canWebhook = (key) => {
  const now = Date.now();
  const last = _lastWebhook.get(key) || 0;
  if (now - last < WEBHOOK_THROTTLE_MS) return false;
  _lastWebhook.set(key, now);
  return true;
};

// formata corpo de mensagem (texto simples)
function buildBody({ title, reason, meta }) {
  const lines = [
    `Projeto: ${PROJECT_NAME}`,
    `Instância: ${INSTANCE_ID}`,
    ...(reason ? [`Motivo: ${reason}`] : []),
    `Quando: ${new Date().toLocaleString()}`
  ];
  const extra = meta && Object.keys(meta).length
    ? '\n' + Object.entries(meta).map(([k, v]) => `${k}: ${String(v)}`).join('\n')
    : '';
  return [title, '', lines.join('\n'), extra].join('\n');
}

export async function notifyDown({ reason, meta = {} }) {
  const title = `🛑 Sessão WhatsApp CAIU — ${INSTANCE_ID}`;
  const subject = `🛑 WhatsApp DOWN — ${INSTANCE_ID}`;
  const bodyTxt = buildBody({ title, reason, meta });

  // e-mail com try/catch interno (em sendAlertEmail)
  await sendAlertEmail({ subject, text: bodyTxt });

  // webhook opcional
  if (ALERT_WEBHOOK_URL && _canWebhook('DOWN')) {
    try {
      await fetch(ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: bodyTxt })
      });
    } catch (e) {
      console.error('[alerts] webhook error (DOWN):', e?.message || e);
    }
  }
}

export async function notifyUp({ meta = {} } = {}) {
  const title = `✅ Sessão WhatsApp OK — ${INSTANCE_ID}`;
  const subject = `✅ WhatsApp UP — ${INSTANCE_ID}`;
  const bodyTxt = buildBody({ title, reason: null, meta });

  await sendAlertEmail({ subject, text: bodyTxt });

  if (ALERT_WEBHOOK_URL && _canWebhook('UP')) {
    try {
      await fetch(ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: bodyTxt })
      });
    } catch (e) {
      console.error('[alerts] webhook error (UP):', e?.message || e);
    }
  }
}
