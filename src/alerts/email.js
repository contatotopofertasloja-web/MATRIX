// src/alerts/email.js
import nodemailer from 'nodemailer';

// ---------- helpers ----------
const bool = (v, d=false) => {
  if (v === undefined || v === null || v === '') return d;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'y' || s === 'yes' || s === 'on';
};
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// ---------- ENV ----------
const host = process.env.SMTP_HOST || 'smtp.gmail.com';
const port = num(process.env.SMTP_PORT, 465);
const secure     = bool(process.env.SMTP_SECURE,      port === 465); // 465 SSL
const requireTLS = bool(process.env.SMTP_REQUIRE_TLS, port === 587); // 587 STARTTLS

const connectionTimeout = num(process.env.SMTP_CONNECTION_TIMEOUT_MS, 8000);
const socketTimeout     = num(process.env.SMTP_SOCKET_TIMEOUT_MS, 8000);
const usePool           = bool(process.env.SMTP_POOL, true);
const maxConnections    = num(process.env.SMTP_POOL_MAX, 3);
const idleTimeout       = num(process.env.SMTP_POOL_IDLE_MS, 300000);

const FROM = process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER || '';
const TO   = process.env.ALERT_EMAIL_TO   || '';

const EMAIL_PROVIDER = String(process.env.EMAIL_PROVIDER || 'auto').toLowerCase(); // 'auto' | 'smtp' | 'resend'
const RESEND_API_KEY = process.env.RESEND_API_KEY || ''; // https://resend.com
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const DISABLE = bool(process.env.ALERT_EMAIL_DISABLE, false);

// ---------- SMTP transporter ----------
const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  requireTLS,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout,
  socketTimeout,
  pool: usePool,
  maxConnections,
  idleTimeout,
});

// log seguro
console.log('[smtp] resolved', { host, port, secure, requireTLS, pool: usePool });

// ---------- throttle ----------
const lastSend = new Map();
const THROTTLE_MS = num(process.env.ALERT_EMAIL_THROTTLE_MS, 120000); // 2 min
const canSend = (subject) => {
  const key = subject || 'alert';
  const now = Date.now();
  const last = lastSend.get(key) || 0;
  if (now - last < THROTTLE_MS) return false;
  lastSend.set(key, now);
  return true;
};

// ---------- providers ----------
async function sendViaSMTP({ subject, text, html }) {
  await transporter.sendMail({ from: FROM, to: TO, subject, text, html });
  return true;
}

async function sendViaResend({ subject, text, html }) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY missing');
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM, // use o mesmo FROM apenas se o domínio estiver verificado na Resend
      to: TO.split(',').map(s => s.trim()).filter(Boolean),
      subject,
      text,
      html
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status} ${res.statusText} ${body}`);
  }
  return true;
}

const NET_ERRORS = new Set(['ETIMEDOUT','ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH']);

// ---------- API principal ----------
export async function sendAlertEmail({ subject, text, html }) {
  try {
    if (DISABLE) { console.log('[alerts][email] disabled by env'); return; }
    if (!FROM || !TO) { console.warn('[alerts][email] FROM/TO não configurados — pulando envio.'); return; }
    if (!canSend(subject)) { console.log('[alerts][email] throttled:', subject); return; }

    if (EMAIL_PROVIDER === 'resend') {
      await sendViaResend({ subject, text, html });
      return;
    }
    if (EMAIL_PROVIDER === 'smtp') {
      await sendViaSMTP({ subject, text, html });
      return;
    }

    // AUTO: tenta SMTP; se der erro de REDE, cai pro Resend (se chave existir)
    try {
      await sendViaSMTP({ subject, text, html });
    } catch (err) {
      const code = err?.code || '';
      if (RESEND_API_KEY && NET_ERRORS.has(code)) {
        console.warn('[alerts][email] SMTP falhou com erro de rede, usando Resend…', code);
        await sendViaResend({ subject, text, html });
      } else {
        throw err;
      }
    }
  } catch (err) {
    // não relança
    const code = err?.code || '';
    console.error('[alerts] email send error:', code || err?.message || err);
  }
}
