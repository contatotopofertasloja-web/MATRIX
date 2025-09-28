// src/adapters/whatsapp/index.js
// Ponte única para drivers de WhatsApp (Baileys por padrão)

const ADAPTER = String(process.env.WPP_ADAPTER || "baileys").toLowerCase();

let impl = null;
if (ADAPTER === "baileys") {
  impl = await import("./baileys/index.js");
} else {
  // fallback temporário: usa Baileys
  impl = await import("./baileys/index.js");
}

export const init            = impl.init            || (async ()=>{});
export const stop            = impl.stop            || (async ()=>{});
export const isReady         = impl.isReady         || (()=> false);
export const getQrDataURL    = impl.getQrDataURL    || (async ()=> null);
export const forceNewQr      = impl.forceNewQr      || impl.forceRefreshQr || (async ()=> false);
export const logoutAndReset  = impl.logoutAndReset  || (async ()=> false);
export const createBaileysClient = impl.createBaileysClient || (async ()=> ({}));

export const adapter = impl.adapter || {
  onMessage() {},
  async sendMessage(){ throw new Error("adapter not ready"); },
  async sendImage(){ throw new Error("adapter not ready"); },
  async sendAudio(){ throw new Error("adapter not ready"); },
};

export default {
  init, stop, isReady, getQrDataURL, forceNewQr, logoutAndReset, createBaileysClient, adapter
};
