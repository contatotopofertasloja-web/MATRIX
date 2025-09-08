// configs/bots/claudia/flow/greet.js
import { settings } from '../../../../src/core/settings.js';

/**
 * Flow: greet
 * - Envia FOTO do produto na abertura + 1ª fala curta
 * - Nunca envia link aqui; sem cupom
 * - Se não houver imagem, cai para texto simples
 */
export default async function greet() {
  const productImage =
    settings?.media?.opening_photo_url ||
    settings?.product?.image_url ||
    null;

  const openingMsgs = settings?.messages?.opening;
  const caption =
    (Array.isArray(openingMsgs) && openingMsgs[0]) ||
    'Oi! 💖 Eu sou a Cláudia. Quer me contar rapidinho como é seu cabelo (liso, ondulado, cacheado ou crespo)?';

  if (productImage && (settings?.flags?.send_opening_photo ?? true)) {
    return {
      type: 'image',
      imageUrl: productImage,
      caption,
    };
  }

  // Fallback sem imagem
  return {
    type: 'text',
    text: caption,
  };
}
