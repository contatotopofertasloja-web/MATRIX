// src/core/fsm.js
// Máquina de estados simples para controlar funil da Cláudia
// Usa Redis (se configurado) ou memória local como fallback

import Redis from "ioredis";

const REDIS_URL = process.env.MATRIX_REDIS_URL || process.env.REDIS_URL || "";
let redis = null;
if (REDIS_URL) {
  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    console.log("[FSM] Redis conectado");
  } catch (e) {
    console.warn("[FSM] Falha no Redis, usando memória local");
    redis = null;
  }
}

// fallback memória local
const memoryStore = new Map();

// helpers para chave por user
function key(userId) {
  return `fsm:session:${userId}`;
}

// busca estado da sessão
export async function getSession(userId) {
  if (!userId) return {};
  try {
    if (redis) {
      const raw = await redis.get(key(userId));
      return raw ? JSON.parse(raw) : {};
    }
  } catch (e) {
    console.warn("[FSM] getSession erro:", e?.message || e);
  }
  return memoryStore.get(userId) || {};
}

// salva estado
export async function setSession(userId, data = {}) {
  if (!userId) return;
  try {
    if (redis) {
      await redis.set(key(userId), JSON.stringify(data), "EX", 60 * 60 * 6); // expira 6h
      return;
    }
  } catch (e) {
    console.warn("[FSM] setSession erro:", e?.message || e);
  }
  memoryStore.set(userId, data);
}

// limpa estado
export async function clearSession(userId) {
  if (!userId) return;
  try {
    if (redis) {
      await redis.del(key(userId));
      return;
    }
  } catch (e) {
    console.warn("[FSM] clearSession erro:", e?.message || e);
  }
  memoryStore.delete(userId);
}

// -----------------------------
// conveniências para slots
// -----------------------------
export async function getSlot(userId, slot) {
  const sess = await getSession(userId);
  return sess?.slots?.[slot];
}

export async function setSlot(userId, slot, value) {
  const sess = await getSession(userId);
  sess.slots = { ...(sess.slots || {}), [slot]: value };
  await setSession(userId, sess);
}

export async function getStage(userId) {
  const sess = await getSession(userId);
  return sess?.stage || "recepcao";
}

export async function setStage(userId, stage) {
  const sess = await getSession(userId);
  sess.stage = stage;
  await setSession(userId, sess);
}
