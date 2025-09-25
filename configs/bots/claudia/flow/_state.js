// configs/bots/claudia/flow/_state.js
// Helpers de estado para flows da Cláudia
// Agora usa src/core/memory.js como backend

import { remember, recall } from "../../../../src/core/memory.js";

export { remember, recall };

export function initialState() {
  return {
    profile: { name:null, hair_type:null, goal:null, had_prog_before:null },
    stage: null,
    turns: 0,
    asked: {},
  };
}

export function callUser(state) {
  return state?.profile?.name || "";
}

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
  a[key] = { at: Date.now(), count: (a[key]?.count||0)+1 };
  return a[key];
}

export function isFilled(state, key) {
  const v = state?.profile?.[key];
  return v != null && v !== "";
}

export function filledSummary(state) {
  const p = state?.profile || {};
  const map = {
    hair_type: v => `cabelo **${v}**`,
    had_prog_before: v => v ? "**já fez** progressiva" : "**nunca fez** progressiva",
    goal: v => `objetivo **${v}**`,
  };
  return Object.entries(p).filter(([k,v])=>v!=null && v!=="" && map[k]).map(([k,v])=> map[k](v));
}

export function tagReply(_settings, text, tag="flow") {
  const t = String(text||"").trim();
  return t ? `${t} (${tag})` : "";
}
