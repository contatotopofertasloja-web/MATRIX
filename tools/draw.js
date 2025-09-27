// tools/draw.js
// Uso: node tools/draw.js 2025-09   (ou sem args para mês corrente)
// Fail-soft: não derruba o processo no Railway se promotions.js não existir.

const monthArg = process.argv[2] || null;

(async () => {
  let promos;
  try {
    promos = await import('../src/core/promotions.js');
  } catch (e) {
    console.warn('[draw] promotions.js ausente — sorteio desabilitado.', e?.message || e);
    console.log('=== Sorteio ===\nMódulo indisponível. Nenhuma ação executada.');
    process.exitCode = 0;
    return;
  }

  const { drawWinners, exportMonth } = promos;
  if (typeof drawWinners !== 'function' || typeof exportMonth !== 'function') {
    console.warn('[draw] API inválida em promotions.js — abortando sem erro.');
    process.exitCode = 0;
    return;
  }

  const res = drawWinners(monthArg || undefined, 3);
  if (!res?.ok) {
    console.error('[draw] erro:', res?.error || 'desconhecido');
    process.exitCode = 1;
    return;
  }

  const exp = exportMonth(res.month);
  console.log('=== Sorteio ===');
  console.log('Mês:', res.month);
  console.log('Total participações:', (exp?.entries || []).length);
  console.log('Vencedoras (1º, 2º, 3º):');
  res.winners.forEach((w, i) => {
    console.log(`${i+1}º ->`, { jid: w.jid, order_id: w.order_id, status: w.status, delivered_at: w.delivered_at });
  });
})();
