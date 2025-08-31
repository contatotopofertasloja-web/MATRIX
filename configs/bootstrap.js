//configs/botstrap.js
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

export function loadBotConfig() {
  const botId = process.env.BOT_ID || 'claudia';
  const file = path.join(process.cwd(), 'configs', 'bots', botId, 'settings.yaml');

  if (!fs.existsSync(file)) {
    throw new Error(`Config do bot não encontrada: ${file}`);
  }

  const raw = fs.readFileSync(file, 'utf-8');
  const cfg = yaml.parse(raw);

  // injeta em process.env (mantém compatibilidade com código atual)
  process.env.PRICE_ORIGINAL = String(cfg.product?.price_original || '');
  process.env.PRICE_TARGET   = String(cfg.product?.price_target || '');
  process.env.CHECKOUT_LINK  = cfg.product?.checkout_link || '';
  process.env.COUPON_CODE    = cfg.product?.coupon_code || '';

  return cfg;
}
