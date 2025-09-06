// src/alerts/email.js
import nodemailer from 'nodemailer';

// ---------- helpers ----------
const bool = (v, d = false) => {
  if (v === undefined || v === null || v === '') return d;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'y' || s === 'yes' || s === 'on';
};
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// ---------- envs ----------
const host = process.env.SMTP_HOST || 'smtp.gmail.com';
const port = num(process.env.SMTP_PORT, 465);

// defaults coerentes pelo port (evita inversão "string truthy"):
// - 465 => SSL (secure:true), requireTLS:false
// - 587 => STARTTLS (secure:false), requireTLS:true
const secure     = bool(process.env.SMTP_SECURE,      port === 465);
const requireTLS = bool(process.env.SMTP_REQUIRE_TLS, port === 587);

// timeouts/pool (opcionais)
const connectionTimeout = num(process.env.SMTP_CONNECTION_TIMEOUT_MS, 8000);
const socketTimeout     = num(process.env.SMTP_SOCKET_TIMEOUT_MS, 8000);
const usePool           = bool(process.env.SMTP_POOL, true);
const maxConnections    = num(process.env.SMTP_POOL_MAX, 3);
const idleTimeout       = num(process.env.SMTP_POOL_IDLE_MS, 300000);

// remetente/destinos (validados no momento do envio)
const FROM = process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER || '';
const TO   = process.env.ALERT_EMAIL_TO   || '';

// ---------- transporter ----------
export const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  requireTLS,
  auth: {
    user: process.env.SMTP_USER,
    // Gmail: usar SENHA DE APP sem espaços (ex.: "trsb tmkt fxvj treb" -> "trsbtmktfxvjtreb")
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout,
  socketTimeout,
  pool: usePool,
  maxConnections,
  idleTimeout,
});

// log seguro (sem segredos)
console.log('[smtp] resolved', { host, port, secure, requireTLS, pool: usePool });

// ---------- anti-flood por assunto ----------
const lastSend = new Map();
const THROTTLE_MS = num(process.env.ALERT_EMAIL_THROTTLE_MS, 120000); // 2 min

function canSend(subject) {
  const key = subject || 'alert';
  const now = Date.now();
  const last = lastSend.get(key) || 0;
  if (now - last < THROTTLE_MS) return false;
  lastSend.set(key, now);
  return true;
}

// ---------- envio com proteção ----------
export async function sendAlertEmail({ subject, text, html }) {
  try {
    if (!FROM || !TO) {
      console.warn('[alerts][email] FROM/TO não configurados — pulando envio.');
      return;
    }
    if (!canSend(subject)) {
      console.log('[alerts][email] throttled:', subject);
      return;
    }
    await transporter.sendMail({
      from: FROM,
      to: TO,
      subject: subject || 'Alerta',
      text: text || undefined,
      html: html || undefined,
    });
  } catch (err) {
    // não relança: registra e segue o jogo
    const code = err?.code || '';
    console.error('[alerts] email send error:', code || err?.message || err);
  }
}
