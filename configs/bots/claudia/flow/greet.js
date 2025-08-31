// configs/bots/claudia/flow/greet.js
import { settings } from '../../../src/core/settings.js';

/**
 * Flow: greet
 * - envia a FOTO do produto (imagem carregada no WhatsApp) logo na abertura
 * - mantém o funil intacto (NÃO envia link de checkout aqui)
 */
export default async function greet() {
  const productImage =
    settings?.product?.image_url ||
    settings?.product?.imageUrl ||
    'https://cdn.shopify.com/s/files/1/0947/7609/9133/files/Inserirumtitulo_8.png?v=1755836200';

  const openingMsgs = settings?.messages?.opening;
  const opening =
    (Array.isArray(openingMsgs) && openingMsgs[0]) ||
    'Oi! 💖 Eu sou a Cláudia. Como é seu cabelo (liso, ondulado, cacheado ou crespo)?';

  // Retorna um objeto especial que o adapter/worker entende como "enviar imagem"
  return {
    type: 'image',
    imageUrl: productImage,
    caption: opening,
  };
}
