import type { WhatsAppAdapter } from '../index';

export const adapter: WhatsAppAdapter = {
  async sendMessage(to, text) {
    throw new Error('Baileys sendMessage: implementar integração aqui');
  },
  async sendImage(to, url, caption) {
    throw new Error('Baileys sendImage: implementar integração aqui');
  },
  onMessage(handler) {
    // ligar o handler no listener do Baileys
    // ex.: sock.ev.on('messages.upsert', ...)
    // chamar handler({ from, text, hasMedia })
  }
};
