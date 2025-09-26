// configs/bots/maria/flow/close.js
// Recebe CEP/endereço, ratifica informações e confirma a reserva — memória persistente.

import { recall, remember } from '../../../../src/core/memory.js';

export function match(text = '') {
  const t = String(text || '').toLowerCase();
  if (/\b\d{5}-?\d{3}\b/.test(t)) return true; // CEP
  if (/\b(rua|av\.?|avenida|travessa|estrada|bairro|cidade|cep|n[ºo]|numero|número)\b/i.test(t)) return true;
  if (/\b(endereco|endereço)\b/i.test(t)) return true;
  return false;
}

function extractCEP(msg = '') {
  const m = String(msg).match(/\b(\d{5})-?(\d{3})\b/);
  return m ? `${m[1]}-${m[2]}` : null;
}

export default async function close({ userId, text, settings }) {
  const price = settings?.product?.price_target ?? settings?.product?.promo_price ?? 150;
  const link  = settings?.product?.checkout_link ?? settings?.product?.site_url ?? '';
  const msg = String(text || '');

  const st = await recall(userId);

  // CEP
  const cep = extractCEP(msg);
  if (cep && !st?.cep) await remember(userId, { cep });

  // Endereço (heurística simples)
  if (/\b(rua|av|avenida|bairro|cidade|n[ºo]|numero|número|cep)\b/i.test(msg)) {
    await remember(userId, { address: msg.trim() });
  }

  const cur = await recall(userId);
  const namePart = cur?.name ? ` ${cur.name}` : '';

  if (!cur?.cep) {
    return `Show${namePart}! Me envia seu **CEP** pra eu checar a disponibilidade?`;
    }

  if (!cur?.address) {
    return `CEP **${cur.cep}** anotado ✅ Agora me passa seu **endereço completo** (rua, número, bairro e cidade), por favor.`;
  }

  // Reserva marcada
  await remember(userId, { reserved: true });

  const lines = [
    `Prontinho${namePart}! 🎉 O produto foi **reservado** para entrega na região do CEP **${cur.cep}**.`,
    `Pagamento é **na entrega (COD)**. Nosso entregador vai entrar em contato para **agendar** a entrega.`,
    (link ? `Se preferir, aqui está o link seguro para acompanhar o pedido: ${link}` : ''),
    `Qualquer dúvida, estou à disposição. Posso ajudar em mais algo?`
  ].filter(Boolean);

  return lines.join(' ');
}
