// configs/bots/maria/flow/_state.js
// Memória ultra simples por contato (process memory).
// Obs.: persiste enquanto o processo estiver de pé (MVP). Depois migramos para Redis/DB no core.

const _mem = new Map(); // userId -> { name, hair, cep, address, interested, reserved }

export function getState(userId) {
  if (!_mem.has(userId)) _mem.set(userId, {});
  return _mem.get(userId);
}

export function setState(userId, patch = {}) {
  const cur = getState(userId);
  const next = { ...cur, ...patch };
  _mem.set(userId, next);
  return next;
}

export function clearState(userId) {
  _mem.delete(userId);
}

export default { getState, setState, clearState };
