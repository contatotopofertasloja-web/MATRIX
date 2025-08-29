// src/bot.js
import { intentOf } from './core/intent.js';
import { settings, BOT_ID } from './core/settings.js';

/**
 * Importa dinamicamente um flow a partir de configs/bots/<BOT_ID>/flow/<name>.js
 * Usa URL relativa ao arquivo atual para funcionar em qualquer SO.
 */
async function loadFlow(name) {
  const url = new URL(`../configs/bots/${BOT_ID}/flow/${name}.js`, import.meta.url);
  try {
    const mod = await import(url.href);
    return mod?.[name] || mod?.default || Object.values(mod)[0];
  } catch (e) {
    console.warn(`[BOT] Flow "${name}" não encontrado para "${BOT_ID}" (${e?.message})`);
    return null;
  }
}

// carrega todos os flows principais
const flows = {
  greet:     await loadFlow('greet'),
  qualify:   await loadFlow('qualify'),
  offer:     await loadFlow('offer'),
  close:     await loadFlow('closeDeal'),
  post_sale: await loadFlow('postSale'),
};

function fallback(intent) {
  // respostas padrão úteis quando o flow específico não existir
  if (intent === 'delivery') return 'Me passa seu CEP rapidinho que já te confirmo prazo e frete 🚚';
  if (intent === 'payment')  return 'Trabalhamos com Pagamento na Entrega (COD). Se preferir, posso te passar outras opções.';
  if (intent === 'features') return 'É um tratamento sem formol, que alinha e nutre. Posso te enviar o passo a passo de uso?';
  if (intent === 'objection') return 'Te entendo! É produto regularizado e com garantia. Quer que eu te mande o passo a passo e resultados?';

  const name = settings?.persona?.display_name || 'assistente';
  return `Consegue me contar rapidinho sobre seu cabelo? 😊 (liso, ondulado, cacheado ou crespo?)`;
}

export const bot = {
  /**
   * Roteador principal: decide a intent e chama o flow correspondente.
   * Retorna sempre string (se o flow retornar array, convertemos para linhas).
   */
  async handleMessage({ userId, text, context }) {
    const intent = intentOf(text);
    const fn =
      (intent === 'close'     ? flows.close :
       intent === 'post_sale' ? flows.post_sale :
       flows[intent]);

    if (typeof fn === 'function') {
      const out = await fn({ userId, text, context, settings });
      if (Array.isArray(out)) return out.filter(Boolean).join('\n'); // compat
      return String(out ?? '').trim() || fallback(intent);
    }

    return fallback(intent);
  }
};

console.log(`[BOT] Ativa: ${BOT_ID} — flows carregados (${Object.keys(flows).filter(k => typeof flows[k]==='function').join(', ')})`);
