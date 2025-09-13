// Saudação + foto opcional + pergunta aberta + usa nome se houver
import settings from '../../settings.yaml' assert { type: 'yaml' };

export default async function greet(ctx = {}) {
  const { jid, send, userName } = ctx;
  const img = settings?.media?.opening_photo_url || null;
  const name = userName ? ` ${userName}` : '';
  const caption =
    `Oi${name}! 💛 Eu sou a Cláudia da TopOfertas.\n` +
    `Pra gente começar: seu cabelo é liso, ondulado, cacheado ou crespo?\n` +
    `Se preferir, me diz como posso te chamar 😊`;

  if (img && (settings?.flags?.send_opening_photo ?? true)) {
    await send(jid, { type: 'image', url: img, caption });
    return;
  }
  await send(jid, { type: 'text', text: caption });
}
