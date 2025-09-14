// src/core/fsm.js
// Máquina de estados leve + store de sessão (Redis opcional, memória fallback).
// NEUTRO (sem cheiro de bot específico). Usado por qualquer bot plugável.

import crypto from "node:crypto";

let redis = null;
async function getRedis() {
  if (redis !== null) return redis;
  try {
    // Tenta carregar o cliente Redis do projeto (ex.: src/core/redis.js)
    const mod = await import("./redis.js").catch(() => null);
    if (mod?.getRedis) {
      redis = await mod.getRedis();
    } else if (process.env.MATRIX_REDIS_URL) {
      // Fallback genérico caso o projeto use ioredis/redis padrão
      const { createClient } = await import("redis");
      const client = createClient({ url: process.env.MATRIX_REDIS_URL });
      client.on("error", (e) => console.error("[FSM][redis] error", e));
      await client.connect();
      redis = client;
    } else {
      redis = undefined; // força memory store
    }
  } catch (e) {
    console.warn("[FSM] Redis indisponível, usando memória. Motivo:", e?.message || e);
    redis = undefined;
  }
  return redis;
}

// -----------------------------
// Store em memória (fallback) |
// -----------------------------
const mem = {
  map: new Map(), // key => { data, expireAt }
  ttlMs: (() => {
    const h = Number(process.env.SESSION_TTL_HOURS || 24);
    return Math.max(1, h) * 60 * 60 * 1000;
  })(),
  now() { return Date.now(); },
  get(key) {
    const item = this.map.get(key);
    if (!item) return null;
    if (item.expireAt && item.expireAt < this.now()) {
      this.map.delete(key);
      return null;
    }
    return item.data;
  },
  set(key, value) {
    this.map.set(key, { data: value, expireAt: this.now() + this.ttlMs });
  },
  del(key) {
    this.map.delete(key);
  },
};

// -------------------------
// Chaves e defaults       |
// -------------------------
const DEFAULT_STAGE = "recepcao"; // recepcao → qualificacao → oferta → fechamento → posvenda
const NS = String(process.env.FSM_NAMESPACE || "matrix:fsm");
const TTL_SEC = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24); // 24h

function sessionKey(botId, userId) {
  return `${NS}:${botId}:${userId}`;
}

function newSession({ botId, userId, extra }) {
  return {
    id: crypto.randomUUID(),
    botId,
    userId,
    stage: DEFAULT_STAGE,
    slots: {},          // ex.: { nome, tipo_cabelo, objetivo, ... }
    context: {},        // livre: rastros de decisões
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  };
}

// -------------------------
// API pública             |
// -------------------------

/**
 * Obtém a sessão atual do usuário (ou cria, se não existir).
 */
export async function getSession(botId, userId) {
  const key = sessionKey(botId, userId);
  const r = await getRedis();
  if (r) {
    const raw = await r.get(key);
    if (!raw) {
      const s = newSession({ botId, userId });
      await r.set(key, JSON.stringify(s), { EX: TTL_SEC });
      return s;
    }
    try { return JSON.parse(raw); } catch { /* fallthrough */ }
    const s = newSession({ botId, userId });
    await r.set(key, JSON.stringify(s), { EX: TTL_SEC });
    return s;
  } else {
    const found = mem.get(key);
    if (found) return found;
    const s = newSession({ botId, userId });
    mem.set(key, s);
    return s;
  }
}

/**
 * Atualiza (merge) a sessão do usuário.
 */
export async function updateSession(botId, userId, patch = {}) {
  const key = sessionKey(botId, userId);
  const r = await getRedis();
  if (r) {
    const cur = await getSession(botId, userId);
    const next = deepMerge(cur, patch);
    next.updatedAt = Date.now();
    await r.set(key, JSON.stringify(next), { EX: TTL_SEC });
    return next;
  } else {
    const cur = await getSession(botId, userId);
    const next = deepMerge(cur, patch);
    next.updatedAt = Date.now();
    mem.set(key, next);
    return next;
  }
}

/**
 * Limpa a sessão do usuário.
 */
export async function clearSession(botId, userId) {
  const key = sessionKey(botId, userId);
  const r = await getRedis();
  if (r) await r.del(key);
  mem.del(key);
}

/**
 * Helpers de alto nível
 */
export async function setStage(botId, userId, stage) {
  return updateSession(botId, userId, { stage });
}

export async function setSlot(botId, userId, name, value) {
  const cur = await getSession(botId, userId);
  const slots = { ...(cur.slots || {}), [name]: value };
  return updateSession(botId, userId, { slots });
}

export async function setSlots(botId, userId, partial = {}) {
  const cur = await getSession(botId, userId);
  const slots = { ...(cur.slots || {}), ...(partial || {}) };
  return updateSession(botId, userId, { slots });
}

// -------------------------
// Util                    |
// -------------------------
function deepMerge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return b.slice();
  if (isObj(a) && isObj(b)) {
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = deepMerge(a[k], b[k]);
    return out;
  }
  return b === undefined ? a : b;
}
function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }

export default {
  getSession,
  updateSession,
  clearSession,
  setStage,
  setSlot,
  setSlots,
};
