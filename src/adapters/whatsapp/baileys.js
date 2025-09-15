import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  downloadContentFromMessage,
  jidNormalizedUser
} from '@whiskeysockets/baileys';
import Pino from 'pino';
import { toDataURL } from 'qrcode';

let _sock = null;
let _onMsgCb = null;
let _stopRequested = false;
let _lastQrText = null;

const SESSION   = process.env.WPP_SESSION || 'default';
const LOG_LEVEL = process.env.BAILEYS_LOG_LEVEL || 'error';
const logger    = Pino({ level: LOG_LEVEL });

export async function init({ onReady, onQr, onDisconnect } = {}) {
  _stopRequested = false;
  const { state, saveCreds } = await useMultiFileAuthState(`.wpp_auth/${SESSION}`);
  const { version } = await fetchLatestBaileysVersion();

  _sock = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: state,
    logger,
    browser: ['Matrix IA 2.0', 'Chrome', '1.0'],
    syncFullHistory: false,
  });

  _sock.ev.on('creds.update', saveCreds);

  _sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      _lastQrText = qr;
      try {
        const dataURL = await toDataURL(qr, { margin: 2, width: 320 });
        if (typeof onQr === 'function') onQr(dataURL);
      } catch (e) {
        logger.warn({ msg: 'QR toDataURL fail', err: e?.message || e });
      }
    }

    if (connection === 'open') {
      _lastQrText = null;
      if (typeof onReady === 'function') onReady();
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect =
        !_stopRequested &&
        reason !== DisconnectReason.loggedOut &&
        reason !== DisconnectReason.badSession;

      if (typeof onDisconnect === 'function') onDisconnect(reason);
      if (shouldReconnect) setTimeout(() => init({ onReady, onQr, onDisconnect }), 1000).unref();
    }
  });

  _sock.ev.on('messages.upsert', async ({ type, messages }) => {
    if (type !== 'notify' || !_onMsgCb) return;
    for (const m of messages || []) {
      const remoteJid = m?.key?.remoteJid;
      if (!remoteJid) continue;
      try {
        const msg = m?.message || {};
        const text = String(
          msg.conversation ||
          msg?.extendedTextMessage?.text ||
          ''
        ).trim();

        const hasMedia = Boolean(
          msg?.audioMessage ||
          msg?.imageMessage ||
          msg?.documentMessage ||
          msg?.videoMessage ||
          msg?.stickerMessage
        );

        await _onMsgCb({
          from: jidNormalizedUser(remoteJid),
          text,
          hasMedia,
          raw: m
        });
      } catch (e) {
        logger.warn({ msg: 'onMessage dispatch fail', err: e?.message || e });
      }
    }
  });
}

export function onMessage(cb) {
  _onMsgCb = typeof cb === 'function' ? cb : null;
}

export async function sendMessage(to, { text }, opts = {}) {
  if (!_sock) throw new Error('WPP socket not ready');
  await _sock.sendMessage(to, { text: String(text || '') }, opts);
  return { ok: true };
}

export async function sendImage(to, url, caption = '') {
  if (!_sock) throw new Error('WPP socket not ready');
  await _sock.sendMessage(to, { image: { url }, caption: caption || '' });
  return { ok: true };
}

export async function sendAudio(to, buffer, { mime = 'audio/ogg', ptt = true } = {}) {
  if (!_sock) throw new Error('WPP socket not ready');
  await _sock.sendMessage(to, { audio: buffer, ptt, mimetype: mime });
  return { ok: true };
}

export async function sendVoice(to, buffer, { mime = 'audio/ogg' } = {}) {
  return sendAudio(to, buffer, { mime, ptt: true });
}

export async function getAudioBuffer(rawBaileysMsg) {
  const msg = rawBaileysMsg?.message;
  const audio = msg?.audioMessage;
  if (!audio) return null;
  const stream = await downloadContentFromMessage(audio, 'audio');
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function downloadMedia(rawBaileysMsg, { audioOnly = false } = {}) {
  const msg = rawBaileysMsg?.message;
  const kind = audioOnly ? 'audio' :
    (msg?.imageMessage ? 'image' :
    (msg?.videoMessage ? 'video' :
    (msg?.documentMessage ? 'document' : null)));
  if (!kind) return null;

  const mediaNode =
    kind === 'audio' ? msg.audioMessage :
    kind === 'image' ? msg.imageMessage :
    kind === 'video' ? msg.videoMessage :
    msg.documentMessage;

  const stream = await downloadContentFromMessage(mediaNode, kind);
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function stop() {
  try { _stopRequested = true; } catch {}
  try { await _sock?.logout?.(); } catch {}
  try { await _sock?.end?.(); } catch {}
  _sock = null;
}
