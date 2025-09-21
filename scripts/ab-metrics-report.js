// scripts/ab-metrics-report.js
// Lê logs/metrics.jsonl e imprime conversão A vs B por etapa, salva CSV e JSON.
// Uso: node scripts/ab-metrics-report.js [--file ./logs/metrics.jsonl]

import fs from "node:fs";
import path from "node:path";

const ARG_FILE = process.argv.includes("--file")
  ? process.argv[process.argv.indexOf("--file") + 1]
  : "./logs/metrics.jsonl";

const INPUT = path.resolve(ARG_FILE);
if (!fs.existsSync(INPUT)) {
  console.error(`[ERRO] Arquivo não encontrado: ${INPUT}`);
  process.exit(1);
}

// Ordem canônica do funil de eventos (ajuste se adicionar novos)
const FUNNEL = [
  "sent_opening_image",
  "asked_price",
  "asked_link",
  "sent_checkout",
  "postsale_entered",
];

function parseJSONL(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const ln of lines) {
    try { rows.push(JSON.parse(ln)); } catch {}
  }
  return rows;
}

function groupByVariant(rows) {
  const byVar = new Map(); // variant -> array rows
  for (const r of rows) {
    const v = r.variant ?? "NA";
    if (!byVar.has(v)) byVar.set(v, []);
    byVar.get(v).push(r);
  }
  return byVar;
}

function aggregateCounts(rows) {
  // Conta por ev e por usuário (jid) — conversão real: 1 por usuário por etapa
  const seenByEvAndUser = new Map(); // key: ev::jid
  const counts = Object.fromEntries(FUNNEL.map(ev => [ev, 0]));

  for (const r of rows) {
    const ev = r.ev;
    const jid = r.jid || r.userId || "unknown";
    if (!FUNNEL.includes(ev)) continue;
    const k = `${ev}::${jid}`;
    if (seenByEvAndUser.has(k)) continue; // não duplicar mesmo usuário
    seenByEvAndUser.set(k, 1);
    counts[ev] += 1;
  }
  return counts;
}

function computeRates(counts) {
  // Taxas step-to-step e CR final (postsale_entered) a partir do topo
  const out = {};
  const top = counts[FUNNEL[0]] || 0;
  for (let i = 0; i < FUNNEL.length; i++) {
    const ev = FUNNEL[i];
    const n = counts[ev] || 0;
    const prev = i === 0 ? Math.max(1, top) : Math.max(1, counts[FUNNEL[i - 1]] || 0);
    out[ev] = {
      count: n,
      stepRate: +(100 * n / prev).toFixed(1),
      topRate:  +(100 * n / Math.max(1, top)).toFixed(1),
    };
  }
  out.__top = top;
  out.__final = counts[FUNNEL[FUNNEL.length - 1]] || 0;
  out.__cr = +(100 * out.__final / Math.max(1, top)).toFixed(1);
  return out;
}

function toDisplayTable(perVariant) {
  // Monta uma tabela amigável por variante
  const rows = [];
  for (const [variant, data] of Object.entries(perVariant)) {
    const rates = data.rates;
    rows.push({
      Variant: variant,
      Top: rates.__top,
      "Opening→Price %": rates["asked_price"]?.stepRate ?? 0,
      "Price→Link %":    rates["asked_link"]?.stepRate ?? 0,
      "Link→Checkout %": rates["sent_checkout"]?.stepRate ?? 0,
      "Checkout→Post %": rates["postsale_entered"]?.stepRate ?? 0,
      "CR Final %":      rates.__cr,
    });
  }
  return rows;
}

function saveCSV(perVariant, outPath) {
  const cols = [
    "Variant","Top",
    "Opening","Opening.stepRate","Opening.topRate",
    "asked_price","asked_price.stepRate","asked_price.topRate",
    "asked_link","asked_link.stepRate","asked_link.topRate",
    "sent_checkout","sent_checkout.stepRate","sent_checkout.topRate",
    "postsale_entered","postsale_entered.stepRate","postsale_entered.topRate",
    "CR_Final",
  ];
  const lines = [cols.join(",")];
  for (const [variant, data] of Object.entries(perVariant)) {
    const r = data.rates;
    const row = [
      variant,
      r.__top,
      data.counts["sent_opening_image"] || 0, r["sent_opening_image"]?.stepRate ?? "", r["sent_opening_image"]?.topRate ?? "",
      data.counts["asked_price"] || 0,        r["asked_price"]?.stepRate ?? "",        r["asked_price"]?.topRate ?? "",
      data.counts["asked_link"] || 0,         r["asked_link"]?.stepRate ?? "",         r["asked_link"]?.topRate ?? "",
      data.counts["sent_checkout"] || 0,      r["sent_checkout"]?.stepRate ?? "",      r["sent_checkout"]?.topRate ?? "",
      data.counts["postsale_entered"] || 0,   r["postsale_entered"]?.stepRate ?? "",   r["postsale_entered"]?.topRate ?? "",
      r.__cr,
    ];
    lines.push(row.join(","));
  }
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}

function main() {
  const rows = parseJSONL(INPUT);

  // Agrupa por variante
  const byVar = groupByVariant(rows);
  const perVariant = {};

  for (const [variant, arr] of byVar.entries()) {
    const counts = aggregateCounts(arr);
    const rates  = computeRates(counts);
    perVariant[variant] = { counts, rates };
  }

  // Imprime tabela resumida
  console.log("\n=== Conversão A vs B (por etapa) ===\n");
  console.table(toDisplayTable(perVariant));

  // Salva CSV e JSON
  const OUT_DIR = path.resolve("./logs");
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  saveCSV(perVariant, path.join(OUT_DIR, "metrics_report.csv"));
  fs.writeFileSync(path.join(OUT_DIR, "metrics_report.json"), JSON.stringify(perVariant, null, 2), "utf8");

  console.log("\nArquivos gerados:");
  console.log(" - ./logs/metrics_report.csv");
  console.log(" - ./logs/metrics_report.json\n");
}

main();
