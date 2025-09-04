// src/bot.js
import { adapter } from './adapters/whatsapp/index.js';
import { BOT_ID } from './core/settings.js';

export async function startBot() {
  console.log(`[BOT] Bootando ${BOT_ID}...`);

  if (adapter?.init) await adapter.init();

  if (adapter?.onMessage) {
    adapter.onMessage(async (msg) => {
      const from = msg?.from || msg?.remoteJid || '';
      const text = msg?.text || '';

      console.log(`[BOT][${BOT_ID}] Mensagem de ${from}: ${text}`);

      // resposta mínima pra não travar
      if (text) {
        await adapter.sendMessage(from, `Echo da ${BOT_ID}: ${text}`);
      }
    });
  }
}
