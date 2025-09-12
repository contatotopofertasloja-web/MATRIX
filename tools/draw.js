// tools/draw.js
// Uso: node tools/draw.js 2025-09   (ou sem args para mês corrente)

import { drawWinners, exportMonth } from '../src/core/promotions.js';

const month = process.argv[2] || null;
const res = drawWinners(month || undefined, 3);

if (!res.ok) {
  console.error('[draw] erro:', res.error || 'desconhecido');
  process.exit(1);
}

const exp = exportMonth(res.month);
console.log('=== Sorteio ===');
console.log('Mês:', res.month);
console.log('Total participações:', exp.entries.length);
console.log('Vencedoras (1º, 2º, 3º):');
res.winners.forEach((w, i) => {
  console.log(`${i+1}º ->`, { jid: w.jid, order_id: w.order_id, status: w.status, delivered_at: w.delivered_at });
});
