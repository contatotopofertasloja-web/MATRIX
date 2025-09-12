import settings from '../../settings.yaml' assert { type: 'yaml' };

export default async function greet() {
  const img = settings?.media?.opening_photo_url || null;
  const caption = 'Oi! Eu sou a Cláudia 💛 Seu cabelo é liso, ondulado, cacheado ou crespo?';

  if (img && (settings?.flags?.send_opening_photo ?? true)) {
    return { type: 'image', url: img, caption };
  }
  return { type: 'text', text: caption };
}
