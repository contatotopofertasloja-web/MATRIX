// src/core/flow-loader.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function pathToFileUrl(absPath) {
  const normalized = absPath.replace(/\\/g, '/'); // Windows → URL
  return `file://${normalized}`;
}

export async function loadFlows(botId) {
  const base = resolveFlowDir(botId);
  if (!base) {
    throw new Error(`[flows] diretório não encontrado para bot "${botId}". Esperado em:
 - src/bots/${botId}/flows
 - configs/bots/${botId}/flow`);
  }

  const files = {
    greet:     'greet.js',
    qualify:   'qualify.js',
    offer:     'offer.js',
    close:     'close.js',
    postsale:  'postsale.js',
  };

  const out = {};
  for (const [key, fname] of Object.entries(files)) {
    const full = path.join(base, fname);
    if (fs.existsSync(full)) {
      const mod = await import(pathToFileUrl(full));
      // nomes-padrão exportados por flow:
      if (key === 'greet')     out.greet     = mod.greet     || mod.default;
      if (key === 'qualify')   out.qualify   = mod.qualify   || mod.default;
      if (key === 'offer')     out.offer     = mod.offer     || mod.default;
      if (key === 'close')     out.close     = mod.closeDeal || mod.close || mod.default;
      if (key === 'postsale')  out.post_sale = mod.postSale  || mod.posts   || mod.default;
    }
  }
  return out;
}
