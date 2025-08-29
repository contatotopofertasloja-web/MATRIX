// src/bot.js  (interface mínima para não cair)
export async function startBot({ adapter }) {
  console.log('[BOT] startBot');
  // inicia o adapter de WhatsApp
  if (adapter?.init) await adapter.init();

  // registra callback de mensagens (se existir)
  if (adapter?.onMessage) {
    adapter.onMessage(async (msg) => {
      try {
        const to =
          msg?.from ||
          msg?.remoteJid ||
          msg?.chatId ||
          msg?.fromMe?.to ||
          msg?.sender;

        // Resposta dummy só pra validar o fluxo
        if (adapter?.sendMessage && to) {
          await adapter.sendMessage(to, '👋 Bot online! Em breve respondo com IA.');
        }
      } catch (e) {
        console.error('[BOT] onMessage error', e);
      }
    });
  }
}

export default { startBot };
