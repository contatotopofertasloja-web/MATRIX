// configs/bots/claudia/flow/greet.js
import { settings } from '../../../src/core/settings.js';

/**
 * Flow: greet
 * - envia a FOTO do produto logo na abertura (antes da 1ª fala)
 * - NÃO envia link aqui
 */
export default async function greet() {
  const productImage =
    settings?.media?.opening_photo_url ||
    settings?.product?.image_url ||
    'https://cdn.shopify.com/s/files/1/0947/7609/9133/files/Inserirumtitulo_8.png?v=1755836200';

  const openingMsgs = settings?.messages?.opening;
  const opening =
    (Array.isArray(openingMsgs) && openingMsgs[0]) ||
    'Oi! 💖 Eu sou a Cláudia. Como é seu cabelo (liso, ondulado, cacheado ou crespo)?';

  return {
    type: 'image',
    imageUrl: productImage,
    caption: opening,
  };
}
