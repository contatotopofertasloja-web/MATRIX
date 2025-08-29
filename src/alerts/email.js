// src/alerts/email.js
import nodemailer from "nodemailer";

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
  ALERT_EMAIL_FROM, ALERT_EMAIL_TO,
  PROJECT_NAME = "Matrix", INSTANCE_ID = "unknown"
} = process.env;

let transporter;

export function getMailer() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: false,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      pool: true,
      maxConnections: 3,
      maxMessages: 50
    });
  }
  return transporter;
}

export async function sendAlertEmail({ subject, text, html }) {
  const to = (ALERT_EMAIL_TO || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!to.length) return;

  const mail = {
    from: ALERT_EMAIL_FROM || `"${PROJECT_NAME} Alerts" <no-reply@local>`,
    to,
    subject: subject || `[${PROJECT_NAME}] Aviso`,
    text: text || "",
    html: html || `<pre>${text || ""}</pre>`
  };

  try {
    await getMailer().sendMail(mail);
    return true;
  } catch (err) {
    console.error("[alerts] email send error:", err);
    return false;
  }
}
