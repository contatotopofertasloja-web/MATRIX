// src/core/canary.js
const envBool = (v, d = false) => {
  if (v === undefined || v === null) return d;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'y' || s === 'yes' || s === 'on';
};

export const CANARY_ENABLED = envBool(process.env.CANARY_ENABLED, false);
export const CANARY_PERCENT = Math.max(0, Math.min(100, Number(process.env.CANARY_PERCENT || 0)));
export const CANARY_FLOW_KEY = String(process.env.CANARY_FLOW || 'canary');
const CANARY_SEED = String(process.env.CANARY_SEED || 'matrix-seed');

// parse listas
function parseList(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(n => n.replace(/\D/g, '')); // só dígitos
}
const FORCE_INCLUDE = parseList(process.env.CANARY_INCLUDE);
const FORCE_EXCLUDE = parseList(process.env.CANARY_EXCLUDE);

// hash simples e estável (djb2)
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return h >>> 0;
}

function bucketFor(jid) {
  const id = String(jid || '').replace(/\D/g, '');
  const h = djb2(`${id}:${CANARY_SEED}`);
  return h % 100; // 0..99
}

export function isCanaryUser(jid) {
  if (!CANARY_ENABLED || CANARY_PERCENT <= 0) return false;

  const digits = String(jid || '').replace(/\D/g, '');
  if (!digits) return false;

  if (FORCE_EXCLUDE.includes(digits)) return false;
  if (FORCE_INCLUDE.includes(digits)) return true;

  const b = bucketFor(digits);
  return b < CANARY_PERCENT;
}
