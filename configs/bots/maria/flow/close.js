// configs/bots/maria/flow/close.js
// Recebe CEP/endereço, ratifica informações e confirma a reserva.

import { getState, setState } from './_state.js';

export function match(text = '') {
  const t = String(text || '').toLowerCase();
  // heurísticas: mensagens com muitos números (CEP/endereço), palavras de endereço, etc.
  if (/\b\d{5}-?\d{3}\b/.test(t)) return true; // CEP
  if (/\b(rua|av\.?|avenida|travessa|estrada|bairro|cidade|cep|n[ºo]|numero|número)\b/i.test(t)) return true;
  if (/\b(endereco|endereço)\b/i.test(t)) return true;
  return false;
}

function extractCEP(msg = '') {
  const m = msg.match(/\b(\d{5})-?(\d{3})\b/);
  return m ? `${m[1]}-${m[2]}` : null;
}

export default async function close({ userId, text, settings }) {
  const st = getState(userId);
  const price = settings?.product?.price_target ?? settings?.product?.promo_price ?? 150;
  const link  = settings?.product?.checkout_link ?? settings?.product?.site_url ?? '';

  const cep = extractCEP(String(text || ''));
  if (cep && !st.cep) setState(userId, { cep });

  // Endereço bruto (sem NLP pesada, MVP)
  const maybeAddr = String(text || '').trim();
  if (maybeAddr && /rua|av|avenida|bairro|cidade|n[ºo]|numero|número|cep/i.test(maybeAddr)) {
    setState(userId, { address: maybeAddr });
  }

  const s = getState(userId);
  const name = s.name ? ` ${s.name}` : '';

  // Se ainda falta CEP
  if (!s.cep) {
    return `Show${name}! Me envia seu **CEP** pra eu checar a disponibilidade?`;
  }

  // Se falta endereço
  if (!s.address) {
    return `CEP **${s.cep}** anotado ✅ Agora me passa seu **endereço completo** (rua, número, bairro e cidade), por favor.`;
  }

  // Reserva (MVP: marca como reservado)
  setState(userId, { reserved: true });

  // Resposta final com ratificação
  const lines = [
    `Prontinho${name}! 🎉 O produto foi **reservado** para entrega na região do CEP **${s.cep}**.`,
    `Pagamento é **na entrega (COD)**. Nosso entregador vai entrar em contato para **agendar** a entrega.`,
    (link ? `Se preferir, aqui está o link seguro para acompanhar o pedido: ${link}` : ''),
    `Qualquer dúvida, estou à disposição. Posso ajudar em mais algo?`
  ].filter(Boolean);

  return lines.join(' ');
}
