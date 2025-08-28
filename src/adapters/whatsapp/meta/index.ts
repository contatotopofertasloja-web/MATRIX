import type { WhatsAppAdapter } from '../index';

export const adapter: WhatsAppAdapter = {
  async sendMessage(to, text) {
    throw new Error('Meta Cloud API sendMessage: implementar integração aqui');
  },
  async sendImage(to, url, caption) {
    throw new Error('Meta Cloud API sendImage: implementar integração aqui');
  },
  onMessage(handler) {
    // ligar o handler no webhook da Meta (Express)
    // chamar handler({ from, text, hasMedia })
  }
};
