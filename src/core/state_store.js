// src/core/state_store.js
import fs from 'fs';
import path from 'path';

const BASE = process.env.STATE_DIR || './data/sessions';

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fileFor(jid) {
  const dir = path.join(BASE, today());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${jid}.json`);
}

export function loadState(jid) {
  try {
    const f = fileFor(jid);
    if (fs.existsSync(f)) {
      const raw = fs.readFileSync(f, 'utf8');
      return JSON.parse(raw);
    }
  } catch (_e) {}
  return {}; // estado novo
}

export function saveState(jid, state) {
  try {
    const f = fileFor(jid);
    fs.writeFileSync(f, JSON.stringify(state || {}, null, 2), 'utf8');
  } catch (_e) {}
}

export function rotateOldDays(keepDays = 2) {
  try {
    if (!fs.existsSync(BASE)) return;
    const now = Date.now();
    fs.readdirSync(BASE).forEach(dir => {
      const full = path.join(BASE, dir);
      if (!fs.statSync(full).isDirectory()) return;
      const ageDays = Math.floor((now - new Date(dir + 'T00:00:00').getTime()) / 86400000);
      if (ageDays > keepDays) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    });
  } catch (_e) {}
}
