// src/core/session.js
// Memória de sessão por JID, com TTL e namespacing por bot (Redis hash).
import Redis from 'ioredis';

const REDIS_URL = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || '';
const TTL = Number(process.env.SESSION_TTL_SECONDS || 86400); // 1 dia

const mem = new Map(); // fallback se Redis ausente
let redis = null;
if (REDIS_URL) {
  try {
    redis = new Redis(REDIS_URL);
    // >>> NOVO: hardening — loga e mantém app viva usando fallback em memória
    redis.on('error', (e) => {
      console.warn('[session] redis error:', e?.message || e);
    });
  } catch {
    redis = null;
  }
}

const k = (botId, jid) => `mx:sess:v1:${botId}:${jid}`;

function blankState() {
  return {
    profile: { name: null, hair_type: null, goal: null, had_prog_before: null },
    asked: {},
    ab: {},
    stage: null,
    meta: { created_at: Date.now(), last_seen_at: Date.now() },
  };
}

export async function loadSession(botId, jid) {
  if (!redis) {
    const s = mem.get(k(botId, jid)) || blankState();
    mem.set(k(botId, jid), s);
    s.meta.last_seen_at = Date.now();
    return s;
  }
  try {
    const raw = await redis.hgetall(k(botId, jid));
    const s = blankState();
    for (const [field, val] of Object.entries(raw || {})) {
      try { s[field] = JSON.parse(val); } catch { /* ignore */ }
    }
    s.meta = s.meta || {};
    s.meta.created_at = s.meta.created_at || Date.now();
    s.meta.last_seen_at = Date.now();

    // >>> NOVO: sliding TTL opcional — renova a cada leitura
    try { await redis.expire(k(botId, jid), TTL); } catch {}

    return s;
  } catch {
    const s = mem.get(k(botId, jid)) || blankState();
    mem.set(k(botId, jid), s);
    s.meta.last_seen_at = Date.now();
    return s;
  }
}

export async function saveSession(botId, jid, state) {
  const s = state || blankState();
  if (!redis) {
    mem.set(k(botId, jid), s);
    return true;
  }
  try {
    const payload = {};
    for (const field of ['profile','asked','ab','stage','meta']) {
      payload[field] = JSON.stringify(s[field] ?? null);
    }
    await redis.hset(k(botId, jid), payload);
    await redis.expire(k(botId, jid), TTL);
    return true;
  } catch {
    mem.set(k(botId, jid), s);
    return false;
  }
}
