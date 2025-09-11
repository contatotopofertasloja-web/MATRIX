// configs/bots/claudia/flow/greet.js
import { settings } from '../../../../src/core/settings.js';

/**
 * Flow: greet
 * - Envia FOTO do produto na abertura + 1 fala curta
 * - Nunca envia link aqui; sem cupom
 * - Se não houver imagem, cai para texto simples
 * - Sem "assistente virtual" e já pergunta com opções
 */
export default async function greet() {
  const productImage =
    settings?.media?.opening_photo_url ||
    settings?.product?.image_url ||
    null;

  // 1) Abertura vinda do settings (se houver) — SEM "assistente virtual"
  const openingMsgs = settings?.messages?.opening;
  const opening =
    (Array.isArray(openingMsgs) && openingMsgs[0]) ||
    'Oi! Tudo bem? Como posso te ajudar com seus cabelos hoje? 😊';

  // 2) Pergunta com OPÇÕES para facilitar a resposta
  const askHairType = 'Seu cabelo é *liso*, *ondulado*, *cacheado* ou *crespo*?';

  const caption = `${opening}\n${askHairType}`;

  // 3) Foto de abertura (se habilitada)
  if (productImage && (settings?.flags?.send_opening_photo ?? true)) {
    return {
      type: 'image',
      imageUrl: productImage,
      caption,
    };
  }

  // 4) Fallback sem imagem
  return {
    type: 'text',
    text: caption,
  };
}
