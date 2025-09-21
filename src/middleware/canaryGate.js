// src/middlewares/canaryGate.js
// Gate canário: controla entrada (intake) para evitar gargalo no WhatsApp.
// - Enforce de min-gap por JID (ordem e respiro entre mensagens)
// - Limite global simples (QPS) com janela deslizante
// - Allowlist / Blocklist por JID
// - Usa Redis se disponível; cai para memória caso contrário.

import Redis from 'ioredis';

// -------- Helpers ENV --------
const envBool = (v, d = false) => {
  if (v === undefined || v === null) return d;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'y' || s === 'yes' || s === 'on';
};
const envNum = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const envCsv = (v) =>
  String(v || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

// -------- Parâmetros do Gate (ajustáveis por ENV) --------
const REDIS_URL = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';
const CANARY_PREFIX = process.env.CANARY_PREFIX || `canary:${process.env.WPP_SESSION || 'default'}`;

const MIN_GAP_MS = envNum(process.env.CANARY_MIN_GAP_MS, 1200);       // intervalo mínimo por JID
const GLOBAL_LIMIT = envNum(process.env.CANARY_GLOBAL_QPS, 40);       // requisições por janela
const GLOBAL_WINDOW_MS = envNum(process.env.CANARY_GLOBAL_WINDOW_MS, 1000);

const ALLOWLIST = new Set(envCsv(process.env.CANARY_ALLOWLIST));      // JIDs sempre permitidos
const BLOCKLIST = new Set(envCsv(process.env.CANARY_BLOCKLIST));      // JIDs bloqueados

const ENABLE_LOGS = envBool(process.env.CANARY_LOGS, false);

// -------- Redis (opcional) + Fallback em memória --------
const useRedis = !!REDIS_URL;
let redis = null;
if (useRedis) {
  const useTLS = REDIS_URL.startsWith('rediss://');
  redis = new Redis(REDIS_URL, {
    lazyConnect: false,
    enableReadyCheck: true,
    connectTimeout: 8000,
    keepAlive: 15000,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(30000, 1000 + times * 500),
    reconnectOnError: (err) => {
      const code = err?.code || '';
      const msg  = String(err?.message || '');
      return (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT' || msg.includes('READONLY'));
    },
    tls: useTLS ? { rejectUnauthorized: false } : undefined,
  });

  redis.on('connect', () => ENABLE_LOGS && console.log('[canary][redis] connected'));
  redis.on('ready',   () => ENABLE_LOGS && console.log('[canary][redis] ready'));
  redis.on('end',     () => ENABLE_LOGS && console.warn('[canary][redis] end'));
  redis.on('error',   (e) => ENABLE_LOGS && console.warn('[canary][redis] error:', e?.code || e?.message || e));
}

// Memória (fallback)
const memLastTs = new Map(); // jid -> last_ts
let memGlobalCount = 0;
let memGlobalWindowStart = Date.now();

// -------- Lua script (atômico) para min-gap por JID --------
// KEYS[1] = keyLastTs (string)
// ARGV[1] = now_ms (number)
// ARGV[2] = min_gap_ms (number)
// Return: 1 (permitido) ou 0 (negado)
const LUA_MIN_GAP = `
local last = redis.call('GET', KEYS[1])
local now  = tonumber(ARGV[1])
local gap  = tonumber(ARGV[2])
if last then
  local delta = now - tonumber(last)
  if delta < gap then
    return 0
  end
end
-- grava novo last_ts; TTL ~ 2x gap apenas para limpeza
redis.call('SET', KEYS[1], now, 'PX', math.floor(gap * 2))
return 1
`;

// -------- Implementações --------
async function passMinGapRedis(jid) {
  const now = Date.now();
  const key = `${CANARY_PREFIX}:last:${jid}`;
  const res = await redis.eval(LUA_MIN_GAP, 1, key, now, MIN_GAP_MS);
  return res === 1;
}

function passMinGapMemory(jid) {
  const now = Date.now();
  const last = memLastTs.get(jid) || 0;
  if (now - last < MIN_GAP_MS) return false;
  memLastTs.set(jid, now);
  // limpeza eventual (leve)
  if (memLastTs.size > 5000 && Math.random() < 0.01) {
    const limitAge = now - MIN_GAP_MS * 4;
    for (const [k, ts] of memLastTs) if (ts < limitAge) memLastTs.delete(k);
  }
  return true;
}

async function passGlobalRedis() {
  if (GLOBAL_LIMIT <= 0) return true;
  const now = Date.now();
  const slot = Math.floor(now / GLOBAL_WINDOW_MS);
  const key = `${CANARY_PREFIX}:g:${slot}`;
  const c = await redis.incr(key);
  if (c === 1) {
    // expira essa janela
    await redis.pexpire(key, GLOBAL_WINDOW_MS + 200);
  }
  return c <= GLOBAL_LIMIT;
}

function passGlobalMemory() {
  if (GLOBAL_LIMIT <= 0) return true;
  const now = Date.now();
  if (now - memGlobalWindowStart > GLOBAL_WINDOW_MS) {
    memGlobalWindowStart = now;
    memGlobalCount = 0;
  }
  memGlobalCount += 1;
  return memGlobalCount <= GLOBAL_LIMIT;
}

// -------- API pública --------
export async function tryPass({ from, text }) {
  const jid = String(from || '').trim();
  if (!jid) return false;

  if (BLOCKLIST.has(jid)) {
    ENABLE_LOGS && console.log('[canary] BLOCKLIST hit', jid);
    return false;
  }
  if (ALLOWLIST.has(jid)) {
    // Allowlist ignora global e min-gap
    return true;
  }

  // 1) Limite global (janela curta)
  const globalOk = useRedis ? await passGlobalRedis() : passGlobalMemory();
  if (!globalOk) {
    ENABLE_LOGS && console.log('[canary] global limit deny', { jid });
    return false;
  }

  // 2) Min-gap por JID (ordem e respiro)
  const perJidOk = useRedis ? await passMinGapRedis(jid) : passMinGapMemory(jid);
  if (!perJidOk) {
    ENABLE_LOGS && console.log('[canary] min-gap deny', { jid });
    return false;
  }

  return true;
}

export async function close() {
  try { await redis?.quit?.(); } catch {}
}

export default { tryPass, close };
