// src/alerts/notifier.js
import { sendAlertEmail } from "./email.js";

const { ALERT_WEBHOOK_URL, PROJECT_NAME = "Matrix", INSTANCE_ID = "unknown" } = process.env;

export async function notifyDown({ reason, meta = {} }) {
  const title = `🛑 Sessão WhatsApp CAIU — ${INSTANCE_ID}`;
  const lines = [
    `Projeto: ${PROJECT_NAME}`,
    `Instância: ${INSTANCE_ID}`,
    `Motivo: ${reason || "desconhecido"}`,
    `Quando: ${new Date().toLocaleString()}`
  ];
  const extra = Object.entries(meta).map(([k, v]) => `${k}: ${String(v)}`).join("\n");
  const bodyTxt = [title, "", lines.join("\n"), extra ? `\n${extra}` : ""].join("\n");

  await sendAlertEmail({
    subject: `🛑 WhatsApp DOWN — ${INSTANCE_ID}`,
    text: bodyTxt
  });

  if (ALERT_WEBHOOK_URL) {
    try {
      await fetch(ALERT_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: bodyTxt })
      });
    } catch (e) {
      console.error("[alerts] webhook error:", e);
    }
  }
}

export async function notifyUp({ meta = {} } = {}) {
  const title = `✅ Sessão WhatsApp OK — ${INSTANCE_ID}`;
  const lines = [
    `Projeto: ${PROJECT_NAME}`,
    `Instância: ${INSTANCE_ID}`,
    `Quando: ${new Date().toLocaleString()}`
  ];
  const extra = Object.entries(meta).map(([k, v]) => `${k}: ${String(v)}`).join("\n");
  const bodyTxt = [title, "", lines.join("\n"), extra ? `\n${extra}` : ""].join("\n");

  await sendAlertEmail({
    subject: `✅ WhatsApp UP — ${INSTANCE_ID}`,
    text: bodyTxt
  });
}
