// src/core/flow-loader.js — loader com suporte a runner (handle) e router.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..', '..');

function resolveFlowDir(botId) {
  const candidates = [
    path.join(ROOT, 'src', 'bots', botId, 'flows'),
    path.join(ROOT, 'configs', 'bots', botId, 'flow'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {}
  }
  return null;
}

let currentRouter = null;
export function getCurrentRouter() { return currentRouter; }

function makeFallbackRouter(flowsMap) {
  const order = [
    flowsMap.postsale || flowsMap.post_sale,
    flowsMap.close,
    flowsMap.offer,
    flowsMap.qualify,
    flowsMap.greet,
  ].filter(Boolean);
  return (text = '') => {
    const t = String(text || '');
    for (const f of order) {
      try { if (typeof f?.match === 'function' && f.match(t)) return f; } catch {}
    }
    return flowsMap.greet || null;
  };
}

export async function loadFlows(botId) {
  const base = resolveFlowDir(botId);
  if (!base) {
    throw new Error(`[flows] diretório não encontrado para bot "${botId}". Esperado em:
 - src/bots/${botId}/flows
 - configs/bots/${botId}/flow`);
  }

  const files = { greet:'greet.js', qualify:'qualify.js', offer:'offer.js', close:'close.js', postsale:'postsale.js' };
  const out = {};

  // 1) index.js (router + runner)
  let pickFlow = null;
  let handleRunner = null;
  const indexJs = path.join(base, 'index.js');
  if (fs.existsSync(indexJs)) {
    try {
      const mod = await import(pathToFileURL(indexJs).href);
      if (typeof mod?.pickFlow === 'function') pickFlow = mod.pickFlow;
      if (typeof mod?.handle === 'function')   handleRunner = mod.handle;
    } catch (e) { console.warn('[flow-loader] Falha ao importar index.js:', e?.message || e); }
  }

  // 2) flows unitários
  for (const [key, fname] of Object.entries(files)) {
    const full = path.join(base, fname);
    if (!fs.existsSync(full)) continue;
    try {
      const mod = await import(pathToFileURL(full).href);
      const def = mod?.default;
      if (key === 'greet')     out.greet     = mod.greet     || def;
      if (key === 'qualify')   out.qualify   = mod.qualify   || def;
      if (key === 'offer')     out.offer     = mod.offer     || def;
      if (key === 'close')     out.close     = mod.closeDeal || mod.close || def;
      if (key === 'postsale')  out.postsale  = mod.postSale  || mod.posts || mod.postsale || def;
      if (key === 'postsale' && !out.post_sale) out.post_sale = out.postsale;
    } catch (e) { console.warn(`[flow-loader] Falha ao importar ${key}.js:`, e?.message || e); }
  }

  // 3) router atual
  if (typeof pickFlow === 'function') {
    currentRouter = (text) => { try { return pickFlow(text) || null; } catch { return null; } };
  } else {
    currentRouter = makeFallbackRouter(out);
  }

  // 4) atalho de roteamento
  out.__route = (text) => (currentRouter ? currentRouter(text) : null);

  // 5) runner opcional
  if (typeof handleRunner === 'function') out.__handle = async (ctx) => handleRunner(ctx);

  console.log(`[flow-loader] Flows carregados para bot="${botId}":`, Object.keys(out).join(', '));
  return out;
}
