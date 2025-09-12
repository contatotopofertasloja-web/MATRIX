// src/core/promotions.js
// Ledger de promoções + LOG (NDJSON) + utilitários admin (listar meses, stats, tail do log)

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const DATA_DIR = path.join(ROOT, 'data', 'promotions');
const LOG_FILE = path.join(DATA_DIR, 'received.log');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function pad(n){ return String(n).padStart(2,'0'); }
function monthKey(d = new Date()) {
  const y = d.getFullYear();
  const m = pad(d.getMonth()+1);
  return `${y}-${m}`;
}
function fileForMonth(key) {
  ensureDir(DATA_DIR);
  return path.join(DATA_DIR, `promo-${key}.json`);
}
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { entries: [] }; }
}
function writeJSON(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function appendLog(evt = {}) {
  try {
    ensureDir(DATA_DIR);
    const line = JSON.stringify(evt) + '\n';
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {}
}

export function enroll({ jid, order_id, status = 'paid', delivered_at = null, extra = {} }) {
  const d = delivered_at ? new Date(delivered_at) : new Date();
  const key = monthKey(d);
  const file = fileForMonth(key);
  const data = readJSON(file);

  const entry = {
    jid: String(jid || '').trim(),
    order_id: String(order_id || '').trim(),
    status: String(status || '').toLowerCase(),
    ts: new Date().toISOString(),
    delivered_at: delivered_at || null,
    ...extra,
  };
  if (!entry.jid || !entry.order_id) return { ok: false, error: 'missing jid/order_id' };

  // idempotência simples (não duplica order_id)
  const dup = data.entries.find(e => e.order_id === entry.order_id);
  if (!dup) data.entries.push(entry);
  writeJSON(file, data);

  // log NDJSON
  appendLog({
    ts: entry.ts,
    source: 'webhook/payment',
    month: key,
    jid: entry.jid,
    order_id: entry.order_id,
    status: entry.status,
    delivered_at: entry.delivered_at ?? null
  });

  return { ok: true, month: key, count: data.entries.length };
}

export function exportMonth(key = monthKey()) {
  const file = fileForMonth(key);
  const data = readJSON(file);
  return { ok: true, month: key, entries: data.entries || [] };
}

function pickRandom(arr, n = 3) {
  const res = [];
  const used = new Set();
  while (res.length < Math.min(n, arr.length)) {
    const idx = Math.floor(Math.random() * arr.length);
    if (used.has(idx)) continue;
    used.add(idx);
    res.push(arr[idx]);
  }
  return res;
}

export function drawWinners(key = monthKey(), n = 3) {
  const { entries } = exportMonth(key);
  if (!entries || entries.length === 0) return { ok: false, error: 'no entries' };

  const pool = entries.filter(e => ['paid','delivered'].includes(e.status));
  if (pool.length === 0) return { ok: false, error: 'no eligible entries' };

  const winners = pickRandom(pool, n);
  return { ok: true, month: key, winners };
}

// ============== Admin utils: listar meses e stats por mês ==============
export function monthsAvailable() {
  ensureDir(DATA_DIR);
  const files = fs.readdirSync(DATA_DIR).filter(f => /^promo-\d{4}-\d{2}\.json$/.test(f));
  const months = files
    .map(f => f.replace(/^promo-/, '').replace(/\.json$/, ''))
    .sort(); // crescente
  return months;
}

export function monthStats(key = monthKey()) {
  const { entries } = exportMonth(key);
  const total = entries.length;
  const byStatus = entries.reduce((acc, e) => {
    const s = e.status || 'unknown';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  return { month: key, total, byStatus };
}

// ============== Admin utils: tail do LOG ==============
export function tailLog({ n = 200, grep = '', month = '' } = {}) {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(LOG_FILE)) return { ok: true, lines: [] };

  const raw = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  let lines = raw;
  if (month) lines = lines.filter(l => l.includes(`"month":"${month}"`));
  if (grep)  lines = lines.filter(l => l.toLowerCase().includes(String(grep).toLowerCase()));
  lines = lines.slice(-Math.max(1, Number(n) || 200));
  return { ok: true, lines };
}

export default {
  enroll,
  exportMonth,
  drawWinners,
  monthsAvailable,
  monthStats,
  tailLog,
};
