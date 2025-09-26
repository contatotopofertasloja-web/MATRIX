// configs/bots/claudia/flow/greet.js
import {
  ensureProfile, tagReply, normalizeSettings,
  callUser, filledSummary
} from "./_state.js";
import { remember, recall } from "../../../../src/core/memory.js";

function get(obj, path) {
  return String(path||"").split(".").reduce((acc,k)=> (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
}
function expandTpl(str, ctx) {
  return String(str||"").replace(/{{\s*([^}]+)\s*}}/g, (_,p) => {
    const v = get(ctx, p.trim());
    return v == null ? "" : String(v);
  });
}
function guessName(t = "") {
  const s = String(t || "").trim();
  const m = s.match(/\b(meu\s*nome\s*é|me\s*chamo|sou\s+[oa])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç]{2,})/i);
  if (m?.[2]) return m[2].trim();
  const solo = s.match(/^\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]{2,})\s*$/);
  return solo?.[1] || "";
}

export default async function greet(ctx = {}) {
  const { jid, state = {}, text = "", settings = {} } = ctx;
  const S = normalizeSettings(settings);
  state.turns = (state.turns || 0) + 1;
  ensureProfile(state);

  const maybe = guessName(text);
  if (maybe) {
    state.profile.name = maybe;
    try { await remember(jid, { profile: state.profile }); } catch (e) { console.warn("[greet.remember]", e?.message); }
  } else {
    try {
      const saved = await recall(jid);
      if (saved?.profile?.name && !state.profile.name) state.profile.name = saved.profile.name;
    } catch (e) { console.warn("[greet.recall]", e?.message); }
  }

  const name = callUser(state);
  const haveAny = filledSummary(state);
  const rat = haveAny.length ? `Anotei: ${haveAny.join(" · ")}. ` : "";

  const openingNamedTpl =
    S.messages?.opening_named?.[0] ||
    `${rat}Oi, {{ profile.name }}! Pra te orientar certinho: seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?`;

  const openingTpl =
    S.messages?.opening?.[0] ||
    `Oi! Eu sou a Cláudia da *{{ product.store_name }}*. Pra te orientar certinho: seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?`;

  const ctxTpl = { profile: state.profile || {}, product: S.product || {} };
  const reply = name
    ? expandTpl(openingNamedTpl, ctxTpl)
    : expandTpl(openingTpl, ctxTpl);

  return tagReply(S, reply, "flow/greet");
}
