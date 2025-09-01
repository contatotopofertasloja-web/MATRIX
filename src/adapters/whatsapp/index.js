// Wrapper “alto nível”: fabrica o adapter por sessão e expõe a API usada pelo index/rotas.
import { createBaileysClient } from './baileys/index.js';
import QRCode from 'qrcode';

export const whichAdapter = 'baileys';

export function makeAdapter({ session = 'main', loggerLevel = 'error' } = {}) {
  let client = null;
  let ready = false;
  let lastQR = null;

  const listeners = {
    message: new Set()
  };

  async function init() {
    if (client) return client;

    client = await createBaileysClient({ session, loggerLevel });

    // Conexão / QR / estado
    client.onConnectionUpdate(async (update) => {
      // qr vem como string (base64 do payload); transformamos em dataURL quando solicitarem
      if (update.qr) {
        ready = false;
        lastQR = update.qr;
      }

      if (update.connection === 'open') {
        ready = true;
        lastQR = null;
      }

      await client.gracefulCloseIfNeeded(update);
    });

    // Mensagens
    client.onMessagesUpsert(async ({ messages, type }) => {
      if (type !== 'notify' || !messages?.length) return;
      const m = messages[0];
      for (const fn of listeners.message) {
        try { await fn(m); } catch (e) { /* silencia listener */ }
      }
    });

    return client;
  }

  // === API exposta ===
  async function isReady() {
    return ready === true;
  }

  async function getQrDataURL() {
    // Se já está pronto, não tem QR
    if (ready) return null;
    if (!lastQR) return null;
    // Gera DataURL do QR
    return await QRCode.toDataURL(lastQR, { errorCorrectionLevel: 'M' });
  }

  async function sendMessage(to, text, extra = {}) {
    await init();
    const jid = normalizeJid(to);
    return client.sock.sendMessage(jid, { text, ...extra });
  }

  async function sendImage(to, bufferOrUrl, caption = '') {
    await init();
    const jid = normalizeJid(to);
    let image = null;

    if (Buffer.isBuffer(bufferOrUrl)) {
      image = bufferOrUrl;
    } else if (typeof bufferOrUrl === 'string') {
      // Aceita URL pública
      // Evita dependência externa: delega para o próprio Baileys baixar (passando url)
      image = { url: bufferOrUrl };
    } else {
      throw new Error('sendImage: informe Buffer ou URL');
    }

    return client.sock.sendMessage(jid, { image, caption });
  }

  function onMessage(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.message.add(fn);
    return () => listeners.message.delete(fn);
  }

  return {
    whichAdapter,
    init,
    isReady,
    getQrDataURL,
    sendMessage,
    sendImage,
    onMessage
  };
}

// Helpers
function normalizeJid(raw) {
  const onlyDigits = String(raw).replace(/\D/g, '');
  return onlyDigits.endsWith('@s.whatsapp.net')
    ? onlyDigits
    : `${onlyDigits}@s.whatsapp.net`;
}

export default makeAdapter;
