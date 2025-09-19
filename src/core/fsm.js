// src/core/fsm.js
// FSM neutra com funil determinístico, slot-filling leve, anti-loop e stickiness no fechamento.
// Base: sua versão enviada. Mantive estrutura e acrescentei só os utilitários.

import crypto from "node:crypto";

const DEFAULT_STAGE = process.env.FSM_DEFAULT_STAGE || "greet";
const NS            = process.env.FSM_NAMESPACE || "matrix:fsm";
const TTL_SEC       = Number(process.env.SESSION_TTL_SECONDS || 86400);  // 24h
const TTL_MS        = TTL_SEC * 1000;
const HISTORY_MAX   = Number(process.env.FSM_HISTORY_MAX || 20);
const ASK_COOLDOWN  = Number(process.env.FSM_ASK_COOLDOWN_MS || 90_000); // 90s

// Funil determinístico
export const STAGES = ["greet", "qualify", "offer", "close", "postsale"];
const NEXT_OF = { greet: "qualify", qualify: "offer", offer: "close", close: "postsale", postsale: "postsale" };

let redis = null;

// ------- Redis opcional (compatível com sua base) -------
async function ensureRedis() {
  if (redis !== null) return redis;
  try {
    const mod = await import("./redis.js").catch(() => null);
    if (mod?.getRedis) {
      const r = await mod.getRedis();
      if (r) { redis = r; return redis; }
    }
  } catch {}
  redis = undefined;
  return redis;
}

const mem = {
  map: new Map(), now: () => Date.now(),
  get(k) { const it = this.map.get(k); if (!it) return null; if (it.expireAt < this.now()) { this.map.delete(k); return null; } return it.data; },
  set(k, v) { this.map.set(k, { data: v, expireAt: this.now() + TTL_MS }); },
  del(k) { this.map.delete(k); },
};

const key = (botId, userId) => `${NS}:${botId}:${userId}`;
const safeJson = (s, d = null) => { try { return JSON.parse(String(s || "")); } catch { return d; } };

function newSession({ botId, userId, extra }) {
  return {
    id: crypto.randomUUID(),
    botId, userId,
    stage: DEFAULT_STAGE,
    slots: {
      hair_type: null,         // liso | ondulado | cacheado | crespo
      had_prog_before: null,   // boolean | null
      goal: null,              // "bem liso" | "alinhado"
    },
    flags: {
      opening_photo_sent: false,
    },
    context: {
      history: [],
      asked: {},               // cooldown por pergunta
      events: {},
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  };
}

export async function getSession({ botId, userId, createIfMissing = true, extra = {} }) {
  const k = key(botId, userId);
  const r = await ensureRedis();
  if (r) {
    const raw = await r.get(k);
    if (!raw) {
      if (!createIfMissing) return null;
      const s = newSession({ botId, userId, extra });
      await r.set(k, JSON.stringify(s), { EX: TTL_SEC });
      return s;
    }
    const s = safeJson(raw, null) || newSession({ botId, userId, extra });
    s.updatedAt = Date.now();
    await r.set(k, JSON.stringify(s), { EX: TTL_SEC });
    return s;
  }
  const local = mem.get(k);
  if (!local && !createIfMissing) return null;
  const s = local || newSession({ botId, userId, extra });
  mem.set(k, s);
  return s;
}

export async function saveSession(session) {
  if (!session?.botId || !session?.userId) return;
  session.updatedAt = Date.now();
  const k = key(session.botId, session.userId);
  const r = await ensureRedis();
  if (r) await r.set(k, JSON.stringify(session), { EX: TTL_SEC });
  else mem.set(k, session);
}

// -------- histórico + anti-loop --------
export function pushHistory(session, role, content) {
  if (!session?.context?.history) return;
  session.context.history.push({ ts: Date.now(), role, content });
  while (session.context.history.length > HISTORY_MAX) session.context.history.shift();
}

export function canAsk(session, askId) {
  const last = session?.context?.asked?.[askId] || 0;
  return Date.now() - last > ASK_COOLDOWN;
}
export function markAsked(session, askId) {
  if (!session?.context?.asked) session.context.asked = {};
  session.context.asked[askId] = Date.now();
}

// -------- slots + slot-filling --------
export function setSlot(session, key, value) {
  if (!session?.slots) session.slots = {};
  session.slots[key] = value;
}
export function getSlot(session, key, fallback = null) {
  return session?.slots?.[key] ?? fallback;
}

const RX = {
  HAIR: /\b(liso|ondulado|cachead[oa]|crespo)\b/i,
  YES: /\b(sim|ja fiz|já fiz|fiz sim)\b/i,
  NO: /\b(n[aã]o|nunca fiz|nunca)\b/i,
  GOAL_LISO: /\b(bem\s*liso|liso\s*total|liso\s*escorrido)\b/i,
  GOAL_ALINHAR: /\b(alinhad[oa]|menos\s*frizz|reduzir\s*frizz|diminuir\s*frizz)\b/i,
};

export function applySlotFilling(session, text = "") {
  const t = String(text || "").toLowerCase();

  if (!getSlot(session, "hair_type")) {
    const m = t.match(RX.HAIR);
    if (m) setSlot(session, "hair_type", m[1].toLowerCase().replace("cacheada", "cacheado"));
  }
  if (getSlot(session, "had_prog_before") == null) {
    if (RX.YES.test(t)) setSlot(session, "had_prog_before", true);
    else if (RX.NO.test(t)) setSlot(session, "had_prog_before", false);
  }
  if (!getSlot(session, "goal")) {
    if (RX.GOAL_LISO.test(t)) setSlot(session, "goal", "bem liso");
    else if (RX.GOAL_ALINHAR.test(t)) setSlot(session, "goal", "alinhado");
  }
}

// -------- estágios --------
export function normalizeStage(s = "") {
  const x = String(s || "").toLowerCase();
  if (!STAGES.includes(x)) return "greet";
  return x;
}
export function setStage(session, stage) {
  session.stage = normalizeStage(stage);
}
export function advanceStage(session) {
  const cur = normalizeStage(session.stage);
  session.stage = NEXT_OF[cur] || "qualify";
  return session.stage;
}
export function forceStage(session, stage) {
  session.stage = normalizeStage(stage);
  return session.stage;
}

// Regra de “grudar” no fechamento: só sai se cliente pedir
export function shouldStickToClose(session, userText = "") {
  const t = String(userText || "");
  const cancel = /\b(cancelar|voltar|mudar|n[aã]o quero|parar)\b/i.test(t);
  return session.stage === "close" && !cancel;
}
