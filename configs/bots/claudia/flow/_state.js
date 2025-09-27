// configs/bots/claudia/flow/_state.js
// Utilitários de estado (profile, asked, tagging)

export function ensureProfile(state) {
  state.profile = state.profile || {};
  return state.profile;
}

export function ensureAsked(state) {
  state.asked = state.asked || {};
  return state.asked;
}

export function markAsked(state, key) {
  const a = ensureAsked(state);
  a[key] = true;
}

export function isFilled(state, key) {
  return !!(state.profile && state.profile[key]);
}

export function callUser(state) {
  const p = state.profile || {};
  return p.name ? p.name.split(" ")[0] : "";
}

export function tagReply(ctx, text, tag) {
  return `[${tag}] ${text}`;
}

export function filledSummary(state) {
  const p = state.profile || {};
  const items = [];
  if (p.goal) items.push(`objetivo: ${p.goal}`);
  if (p.phone) items.push(`telefone: ${p.phone}`);
  return items;
}
