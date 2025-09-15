// src/core/fsm.js
// FSM leve e NEUTRA: guarda estado por usuário (stage, slots, context, eventos)
// - Armazena em Redis quando disponível (./redis.js, ioredis ou redis)
// - Fallback em memória com TTL
// - Fornece helpers de slot-filling e transição de estágio, sem "cheiro" de bot

import crypto from "node:crypto";

const DEFAULT_STAGE = process.env.FSM_DEFAULT_STAGE || "recepcao";
const NS            = process.env.FSM_NAMESPACE || "matrix:fsm";
const TTL_SEC       = Number(process.env.SESSION_TTL_SECONDS || 86400);  // 24h
const TTL_MS        = TTL_SEC * 1000;
const HISTORY_MAX   = Number(process.env.FSM_HISTORY_MAX || 10);
const ASK_COOLDOWN  = Number(process.env.FSM_ASK_COOLDOWN_MS || 90_000); // 90s

// --------------------------- Redis bootstrap ---------------------------
let redis = null;
let redisImpl = "none"; // "module", "ioredis", "redis", "none"

async function getRedis() {
  if (redis !== null) return redis;

  // 1) Preferência: módulo local ./redis.js (se o projeto já tiver um pool)
  try {
    const mod = await import("./redis.js").catch(() => null);
    if (mod?.getRedis) {
      redis = await mod.getRedis();
      if (redis) { redisImpl = "module"; return redis; }
    }
  } catch {}

  const url =
    process.env.MATRIX_REDIS_URL ||
    process.env.REDIS_URL ||
    process.env.UPSTASH_REDIS_REST_URL || // só para compat; cliente REST não é usado aqui
    "";

  if (!url) { redis = undefined; redisImpl = "none"; return redis; }

  // 2) ioredis (muito comum no teu projeto)
  try {
    const io = await import("ioredis");
    const client = new io.default(url, {
      lazyConnect: false,
      enableReadyCheck: true,
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(30_000, 1_000 + times * 500),
      tls: url.startsWith("rediss://") ? { rejectUnauthorized: false } : undefined,
    });
    client.on("error", (e) => console.error("[FSM][ioredis] error", e?.message || e));
    await client.connect?.(); // ioredis v5 já conecta no ctor, mas mantemos por compat
    redis = {
      get: (k) => client.get(k),
      set: (k, v, opts) => client.set(k, v, "EX", (opts?.EX ?? TTL_SEC)),
      del: (k) => client.del(k),
      ttl: (k) => client.ttl(k),
    };
    redisImpl = "ioredis";
    return redis;
  } catch {}

  // 3) node-redis (oficial)
  try {
    const { createClient } = await import("redis");
    const client = createClient({ url });
    client.on("error", (e) => console.error("[FSM][redis] error", e?.message || e));
    await client.connect();
    redis = {
      get: (k) => client.get(k),
      set: (k, v, opts) => client.set(k, v, { EX: (opts?.EX ?? TTL_SEC) }),
      del: (k) => client.del(k),
      ttl: (k) => client.ttl(k),
    };
    redisImpl = "redis";
    return redis;
  } catch {}

  // 4) Sem Redis → fallback memória
  redis = undefined;
  redisImpl = "none";
  return redis;
}

// --------------------------- Memória com TTL ---------------------------
const mem = {
  map: new Map(),
  now: () => Date.now(),
  get(k) {
    const it = this.map.get(k);
    if (!it) return null;
    if (it.expireAt < this.now()) { this.map.delete(k); return null; }
    return it.data;
  },
  set(k, v) {
    this.map.set(k, { data: v, expireAt: this.now() + TTL_MS });
  },
  del(k) { this.map.delete(k); },
  touch(k) {
    const it = this.map.get(k);
    if (it) it.expireAt = this.now() + TTL_MS;
  }
};

// --------------------------- Helpers base ---------------------------
function key(botId, userId) {
  return `${NS}:${botId}:${userId}`;
}
function newSession({ botId, userId, extra }) {
  return {
    id: crypto.randomUUID(),
    botId, userId,
    stage: DEFAULT_STAGE,
    slots: {},                 // ex.: { tipo_cabelo: "crespo", objetivo: "reduzir frizz" }
    context: {                 // espaço neutro para o orquestrador
      history: [],             // últimas N mensagens/atos
      asked: {},               // mapa de perguntaId → timestamp
      events: {},              // offer/link/etc → timestamp
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  };
}
function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

// --------------------------- API de sessão ---------------------------
export async function getSession(botId, userId) {
  const r = await getRedis();
  const k = key(botId, userId);

  if (r) {
    const raw = await r.get(k);
    if (raw) return safeParse(raw) || newSession({ botId, userId });
    const s = newSession({ botId, userId });
    await r.set(k, JSON.stringify(s), { EX: TTL_SEC });
    return s;
  }

  const found = mem.get(k);
  if (found) return found;
  const s = newSession({ botId, userId });
  mem.set(k, s);
  return s;
}

export async function updateSession(botId, userId, patch = {}) {
  const r = await getRedis();
  const k = key(botId, userId);

  if (r) {
    const curr = await getSession(botId, userId);
    const merged = { ...curr, ...patch, updatedAt: Date.now() };
    await r.set(k, JSON.stringify(merged), { EX: TTL_SEC });
    return merged;
  }

  const curr = mem.get(k) || newSession({ botId, userId });
  const merged = { ...curr, ...patch, updatedAt: Date.now() };
  mem.set(k, merged);
  return merged;
}

export async function clearSession(botId, userId) {
  const r = await getRedis();
  const k = key(botId, userId);
  if (r) await r.del(k);
  mem.del(k);
}

export async function touch(botId, userId) {
  const r = await getRedis();
  const k = key(botId, userId);
  if (r) {
    const curr = await getSession(botId, userId);
    await r.set(k, JSON.stringify({ ...curr, updatedAt: Date.now() }), { EX: TTL_SEC });
    return;
  }
  mem.touch(k);
}

// --------------------------- Slots (slot-filling) ---------------------------
export async function mergeSlots(botId, userId, newSlots = {}) {
  const s = await getSession(botId, userId);
  const merged = { ...s.slots, ...newSlots };
  return updateSession(botId, userId, { slots: merged });
}
export async function setSlot(botId, userId, key, value) {
  const s = await getSession(botId, userId);
  const merged = { ...s.slots, [key]: value };
  return updateSession(botId, userId, { slots: merged });
}
export async function getSlot(botId, userId, key) {
  const s = await getSession(botId, userId);
  return s?.slots?.[key];
}
export async function hasSlot(botId, userId, key) {
  const s = await getSession(botId, userId);
  return Object.prototype.hasOwnProperty.call(s?.slots || {}, key);
}

// --------------------------- Estágio (FSM simples) ---------------------------
export async function getStage(botId, userId) {
  const s = await getSession(botId, userId);
  return s?.stage || DEFAULT_STAGE;
}
export async function setStage(botId, userId, stage) {
  const next = String(stage || DEFAULT_STAGE).toLowerCase();
  return updateSession(botId, userId, { stage: next });
}
/**
 * advanceStage: não impõe mapa fixo; o ORQUESTRADOR decide.
 * Mantém o core neutro. Apenas aplica o nome e atualiza updatedAt.
 */
export async function advanceStage(botId, userId, nextStage) {
  return setStage(botId, userId, nextStage);
}

// --------------------------- Histórico (contexto leve) -----------------------
export async function pushHistory(botId, userId, entry) {
  if (!entry) return getSession(botId, userId);
  const s = await getSession(botId, userId);
  const hist = Array.isArray(s.context?.history) ? s.context.history.slice(-HISTORY_MAX + 1) : [];
  hist.push({
    ...entry,
    at: Date.now(),
  });
  return updateSession(botId, userId, { context: { ...s.context, history: hist } });
}

// --------------------------- Perguntas com cooldown --------------------------
/**
 * shouldAsk: evita repetir a MESMA pergunta em janela de tempo.
 * Ex.: shouldAsk("tipo_cabelo", 90_000) → true/false
 */
export async function shouldAsk(botId, userId, questionId, cooldownMs = ASK_COOLDOWN) {
  const qid = String(questionId || "").trim();
  if (!qid) return true;
  const s = await getSession(botId, userId);
  const asked = (s.context?.asked || {});
  const lastAt = Number(asked[qid] || 0);
  const now = Date.now();
  const ok = !lastAt || (now - lastAt) > Math.max(0, cooldownMs);
  if (ok) {
    const nextAsked = { ...asked, [qid]: now };
    await updateSession(botId, userId, { context: { ...s.context, asked: nextAsked } });
  }
  return ok;
}

// --------------------------- Eventos (oferta, link, etc.) --------------------
export async function markEvent(botId, userId, eventKey, atTs) {
  const key = String(eventKey || "").trim().toLowerCase();
  if (!key) return getSession(botId, userId);
  const s = await getSession(botId, userId);
  const events = { ...(s.context?.events || {}) };
  events[key] = Number.isFinite(+atTs) ? +atTs : Date.now();
  return updateSession(botId, userId, { context: { ...s.context, events } });
}
export async function lastEventAt(botId, userId, eventKey) {
  const s = await getSession(botId, userId);
  return Number(s?.context?.events?.[String(eventKey || "").trim().toLowerCase()] || 0) || 0;
}

// --------------------------- Contexto arbitrário (remember/forget) ----------
export async function remember(botId, userId, path, value) {
  const s = await getSession(botId, userId);
  const ctx = { ...(s.context || {}) };
  ctx[path] = value;
  return updateSession(botId, userId, { context: ctx });
}
export async function forget(botId, userId, path) {
  const s = await getSession(botId, userId);
  const ctx = { ...(s.context || {}) };
  delete ctx[path];
  return updateSession(botId, userId, { context: ctx });
}

// --------------------------- Debug ------------------------------------------
export function info() {
  return { backend: redisImpl, ns: NS, ttl_sec: TTL_SEC, default_stage: DEFAULT_STAGE };
}
