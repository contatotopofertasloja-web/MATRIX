// Baileys adapter “baixo nível”: cria o socket e devolve utilitários.
// ATENÇÃO: makeWASocket é *named export* no Baileys 6.x.
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers
} from '@whiskeysockets/baileys';
import Pino from 'pino';

export async function createBaileysClient({ session, loggerLevel = 'error' }) {
  // Armazena a sessão em disco (pasta .wpp-sessions/<session>)
  const { state, saveCreds } = await useMultiFileAuthState(`.wpp-sessions/${session}`);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 0] }));

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.appropriate('Matrix', 'Chrome'),
    logger: Pino({ level: loggerLevel })
  });

  // Persistência de credenciais
  sock.ev.on('creds.update', saveCreds);

  // Exponho alguns helpers úteis para o wrapper “alto nível”
  function onConnectionUpdate(cb) {
    sock.ev.on('connection.update', cb);
  }

  function onMessagesUpsert(cb) {
    sock.ev.on('messages.upsert', cb);
  }

  async function gracefulCloseIfNeeded(update) {
    if (update.connection === 'close') {
      const statusCode = update?.lastDisconnect?.error?.output?.statusCode;
      // 401/DisconnectReason.loggedOut => precisa relogar
      if (statusCode === DisconnectReason.loggedOut) {
        try { await sock.logout(); } catch (_) {}
      }
    }
  }

  return {
    sock,
    onConnectionUpdate,
    onMessagesUpsert,
    gracefulCloseIfNeeded
  };
}
