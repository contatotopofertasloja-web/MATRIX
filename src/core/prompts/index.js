// src/core/prompts/index.js
// Carrega o construtor de prompt do bot ativo (BOT_ID) dinamicamente.
// Fallback para prompts "base" caso o bot não tenha prompts próprios.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BOT_ID } from '../settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..', '..');

async function tryImport(href) {
  try { return await import(href); } catch { return null; }
}

// API esperada: exportar buildPrompt({ stage, message, context? }) => { system, user }
export async function getPromptBuilder(botId = BOT_ID) {
  // 1) Bot-specific (configs/bots/<bot>/prompts/index.js)
  const botPrompts = path.join(ROOT, 'configs', 'bots', botId, 'prompts', 'index.js');
  let mod = await tryImport(pathToFileURL(botPrompts).href);
  if (mod?.buildPrompt) return mod.buildPrompt;

  // 2) Fallback por-bot (src/prompts/<bot>/index.js), se você usar esse padrão
  const altBot = path.join(ROOT, 'src', 'prompts', botId, 'index.js');
  mod = await tryImport(pathToFileURL(altBot).href);
  if (mod?.buildPrompt) return mod.buildPrompt;

  // 3) Fallback genérico (src/core/prompts/product.js ou base.js)
  const coreProduct = path.join(ROOT, 'src', 'core', 'prompts', 'product.js');
  mod = await tryImport(pathToFileURL(coreProduct).href);
  if (mod?.buildPrompt) return mod.buildPrompt;

  const coreBase = path.join(ROOT, 'src', 'core', 'prompts', 'base.js');
  mod = await tryImport(pathToFileURL(coreBase).href);
  if (mod?.buildPrompt) return mod.buildPrompt;

  throw new Error('[prompts] Nenhum buildPrompt encontrado para o bot ou fallback.');
}
