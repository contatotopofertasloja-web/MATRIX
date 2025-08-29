// src/core/settings.js
//
// Carrega settings.yaml da bot ativa (ex.: claudia)

import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

function env(name, def) {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? def : v;
}

export const BOT_ID = env('BOT_ID', 'claudia');

// caminho absoluto → configs/bots/<BOT_ID>/settings.yaml
const ROOT = process.cwd();
const BOT_SETTINGS_PATH = path.join(ROOT, 'configs', 'bots', BOT_ID, 'settings.yaml');

// valores default (fallback)
let settings = {
  bot_id: BOT_ID,
  persona: {
    display_name: 'Assistente',
    tone: ['amigável'],
    style: 'Respostas curtas, claras e simpáticas.'
  },
  product: {
    price_original: 197,
    price_target: 170,
    checkout_link: '',
    coupon_code: ''
  },
  flags: { has_cod: true, send_opening_photo: false },
  models_by_stage: {}
};

try {
  if (fs.existsSync(BOT_SETTINGS_PATH)) {
    const raw = fs.readFileSync(BOT_SETTINGS_PATH, 'utf8');
    const parsed = YAML.parse(raw) || {};
    settings = { ...settings, ...parsed };
    console.log(`[SETTINGS] Carregado: ${BOT_SETTINGS_PATH}`);
  } else {
    console.warn(`[SETTINGS] Não encontrado: ${BOT_SETTINGS_PATH}`);
  }
} catch (err) {
  console.error('[SETTINGS] Falha ao carregar YAML:', err.message);
}

export { settings };
