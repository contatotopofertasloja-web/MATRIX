// src/adapters/whatsapp/index.js
// Ponte única para drivers de WhatsApp (Baileys por padrão) + suporte a desativar via WPP_ADAPTER=none

const RAW_ADAPTER = String(process.env.WPP_ADAPTER || "baileys").toLowerCase();

let init, stop, isReady, getQrDataURL, forceNewQr, logoutAndReset, createBaileysClient, adapter;

if (RAW_ADAPTER === "none") {
  // Modo desligado (stub no-op): útil para a Matrix (core) sem WhatsApp próprio
  init = async () => {};
  stop = async () => {};
  isReady = () => false;
  getQrDataURL = async () => null;
  forceNewQr = async () => false;
  logoutAndReset = async () => false;
  createBaileysClient = async () => ({});
  adapter = {
    onMessage() {},
    async sendMessage() { throw new Error("whatsapp adapter disabled on this service"); },
    async sendImage()   { throw new Error("whatsapp adapter disabled on this service"); },
    async sendAudio()   { throw new Error("whatsapp adapter disabled on this service"); },
  };
} else {
  const impl = await import("./baileys/index.js");
  init               = impl.init               || (async ()=>{});
  stop               = impl.stop               || (async ()=>{});
  isReady            = impl.isReady            || (()=> false);
  getQrDataURL       = impl.getQrDataURL       || (async ()=> null);
  forceNewQr         = impl.forceNewQr         || impl.forceRefreshQr || (async ()=> false);
  logoutAndReset     = impl.logoutAndReset     || (async ()=> false);
  createBaileysClient= impl.createBaileysClient|| (async ()=> ({}));

  adapter = impl.adapter || {
    onMessage(){},
    async sendMessage(){ throw new Error("adapter not ready"); },
    async sendImage(){ throw new Error("adapter not ready"); },
    async sendAudio(){ throw new Error("adapter not ready"); },
  };
}

export { init, stop, isReady, getQrDataURL, forceNewQr, logoutAndReset, createBaileysClient, adapter };
export default { init, stop, isReady, getQrDataURL, forceNewQr, logoutAndReset, createBaileysClient, adapter };
