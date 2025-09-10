// configs/bots/claudia/flow/qualify.js
import { callLLM } from '../../../../src/core/llm.js';
import { settings } from '../../../../src/core/settings.js';
import { getSlot, setSlot, getStage, setStage } from '../../../../src/core/fsm.js';
import { intentOf } from '../../../../src/core/intent.js';

/**
 * Slots usados:
 *  - tipo_cabelo: liso | ondulado | cacheado | crespo
 *  - objetivo:    reduzir frizz | controlar volume | alisar | brilho (texto livre curto)
 *  - tem_quimica: sim | nao
 *
 * Regras:
 *  - Se o usuário trouxer "compra" (valor/link), saltamos para oferta.
 *  - Pergunta APENAS 1 coisa por vez (nada de loop).
 *  - Quando todos os slots estiverem preenchidos, mudamos stage → 'oferta'.
 */
const RX_TIPO = /\b(liso|ondulado|cachead[oa]|crespo)\b/i;
const RX_OBJ  = /\b(frizz|volume|alisar|liso|brilho|alinhad[oa])\b/i;
const RX_SIM  = /\b(sim|s|tenho|tem|fiz|quimica|colora[cç][aã]o|alisamento|progressiva)\b/i;
const RX_NAO  = /\b(n[aã]o|nao|n|sem)\b/i;

export async function qualify({ userId, text }) {
  const last = String(text || '').trim();

  // 0) Intenção de compra? -> não qualifica; deixa o roteador mandar para oferta/close
  if (intentOf(last) === 'offer' || intentOf(last) === 'close') {
    await setStage(userId, 'oferta');
    // evitamos falar de preço aqui; apenas sinalizamos avanço
    return 'Beleza! Posso te fazer a proposta agora?';
  }

  // 1) Leitura do estado atual
  const stageAtual = await getStage(userId);
  if (stageAtual !== 'qualificacao') await setStage(userId, 'qualificacao');

  let tipo = await getSlot(userId, 'tipo_cabelo');
  let objetivo = await getSlot(userId, 'objetivo');
  let quimica = await getSlot(userId, 'tem_quimica');

  // 2) Tenta extrair informação da mensagem corrente (reconhecimento leve)
  if (!tipo) {
    const m = last.match(RX_TIPO);
    if (m) { tipo = m[1].toLowerCase(); await setSlot(userId, 'tipo_cabelo', tipo); }
  }
  if (!objetivo) {
    const m = last.match(RX_OBJ);
    if (m) { objetivo = m[1].toLowerCase(); await setSlot(userId, 'objetivo', objetivo); }
  }
  if (!quimica) {
    if (RX_SIM.test(last)) { quimica = 'sim'; await setSlot(userId, 'tem_quimica', 'sim'); }
    else if (RX_NAO.test(last)) { quimica = 'nao'; await setSlot(userId, 'tem_quimica', 'nao'); }
  }

  // 3) Decide próxima (apenas UMA) pergunta
  if (!tipo) {
    return 'Pra eu indicar certinho: seu cabelo é liso, ondulado, cacheado ou crespo?';
  }
  if (!objetivo) {
    // pergunta objetiva
    return 'Quer reduzir frizz, controlar volume ou deixar mais liso/brilhante?';
  }
  if (!quimica) {
    return 'Tem alguma química recente (coloração ou alisamento)?';
  }

  // 4) Tudo preenchido → avançar p/ oferta
  await setStage(userId, 'oferta');

  // Faz uma única transição simpática (sem preço/link aqui)
  const followups = settings?.messages?.qualify_followups || [];
  const resumo = `Entendi: cabelo ${tipo}, objetivo ${objetivo}${quimica === 'sim' ? ', com química' : ''}.`;
  const { text: llm } = await callLLM({
    stage: 'qualificacao',
    system: `Você é ${settings?.persona_name || 'Cláudia'}, direta e simpática.
Confirme que entendeu e chame para a proposta (sem preço/link). Máx 1–2 linhas.`,
    prompt: `Contexto: ${resumo}\nSugestões: ${followups.join(' | ')}`,
  });

  return (llm || 'Show! Já consigo te fazer a proposta, pode ser?').trim();
}
