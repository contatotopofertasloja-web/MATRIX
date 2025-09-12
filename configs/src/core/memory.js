// src/core/memory.js
// Memória leve por JID (slots + timestamps). Em RAM com TTL; fácil trocar por Redis.

const TTL_MS = 60 * 60 * 1000; // 1h
const store = new Map(); // jid -> { data, expiresAt }

function fresh(obj) {
  return { ...obj, expiresAt: Date.now() + TTL_MS };
}

export async function get(jid) {
  const rec = store.get(jid);
  if (!rec) return { slots: {} };
  if (Date.now() > (rec.expiresAt || 0)) {
    store.delete(jid);
    return { slots: {} };
  }
  return rec;
}

export async function set(jid, data) {
  store.set(jid, fresh({ ...(data || {}) }));
}

export async function merge(jid, patch) {
  const cur = await get(jid);
  const merged = { ...(cur || {}), ...(patch || {}) };
  store.set(jid, fresh(merged));
}
