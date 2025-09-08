// src/alerts/notifier.js
// Notificador de alertas: Discord (principal) + E-mail opcional via ./email.js

import fetch from 'node-fetch'; // se o runtime for Node >=18, pode trocar por globalThis.fetch
import { sendAlertEmail } from './email.js';

// ENV
const WEBHOOK_URL =
  process.env.DISCORD_WEBHOOK_URL ||
  process.env.ALERT_WEBHOOK_URL || ''; // compat com antigo

const EMAIL_ENABLED = String(process.env.ALERT_EMAIL_DISABLE || '').trim().toLowerCase()
  ? false
  : true; // email.js também checa FROM/TO/providers; aqui só não bloqueamos à força

// throttle simples por "reason" (evita flood)
const lastNotify = new Map();
const THROTTLE_MS = Number(process.env.ALERT_THROTTLE_MS || 60_000); // 60s

function canNotify(key) {
  const now = Date.now();
  const last = lastNotify.get(key) || 0;
  if (now - last < THROTTLE_MS) return false;
  lastNotify.set(key, now);
  return true;
}

function buildDiscordPayload({ reason, meta = {}, level = 'ERROR' }) {
  const prettyMeta = '```json\n' + JSON.stringify(meta || {}, null, 2).slice(0, 1800) + '\n```';
  const content = `🚨 **Matrix alerta** — ${reason}`;
  return {
    content,
    embeds: [
      {
        title: `Status: ${level}`,
        description: prettyMeta,
        color: 0xff0033,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

async function postToDiscord(payload) {
  if (!WEBHOOK_URL) {
    console.warn('[alerts] Discord WEBHOOK_URL não configurado — pulando envio.');
    return false;
  }
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`webhook ${res.status} ${res.statusText} ${body}`);
  }
  return true;
}

/**
 * Envia notificação de queda/desconexão
 * @param {{reason: string, meta?: object}} opts
 */
export async function notifyDown({ reason, meta = {} }) {
  const subject = `🚨 Matrix alerta: ${reason}`;
  const key = reason || 'alert';

  // 0) Console sempre
  console.warn('[alerts][notifyDown]', { reason, meta });

  // 1) Throttle
  if (!canNotify(key)) {
    console.log('[alerts] throttled:', key);
    return;
  }

  // 2) Discord (principal)
  try {
    const payload = buildDiscordPayload({ reason, meta, level: 'DOWN' });
    await postToDiscord(payload);
    console.log('[alerts] Discord enviado com sucesso');
  } catch (err) {
    console.error('[alerts] falha no Discord:', err?.message || err);
  }

  // 3) E-mail (opcional; email.js já respeita ALERT_EMAIL_DISABLE e valida FROM/TO)
  try {
    if (EMAIL_ENABLED) {
      const text = `Alerta: ${reason}\n\nMeta:\n${JSON.stringify(meta, null, 2)}`;
      await sendAlertEmail({ subject, text, html: undefined });
    }
  } catch (err) {
    console.error('[alerts] falha no e-mail:', err?.message || err);
  }
}
