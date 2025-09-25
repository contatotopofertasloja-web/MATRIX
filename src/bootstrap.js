// bootstrap.js (raiz)
// Carrega o YAML da bot ativa e injeta alguns espelhos em ENV.
// Fail-soft: nunca derruba o processo se o YAML faltar/estiver inválido.

import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

export function loadBotConfig() {
  const botId = process.env.BOT_ID || "claudia";
  const file  = path.join(process.cwd(), "configs", "bots", botId, "settings.yaml");

  if (!fs.existsSync(file)) {
    console.warn("[bootstrap] Config do bot não encontrada:", file);
    return {};
  }

  try {
    const raw = fs.readFileSync(file, "utf-8");
    const cfg = yaml.parse(raw) || {};

    // Espelhos em ENV (compatibilidade com códigos antigos)
    if (cfg.product) {
      const p = cfg.product;
      if (p.price_original != null) process.env.PRICE_ORIGINAL = String(p.price_original);
      if (p.price_target   != null) process.env.PRICE_TARGET   = String(p.price_target);
      if (p.checkout_link)          process.env.CHECKOUT_LINK  = String(p.checkout_link);
      if (p.coupon_code)            process.env.COUPON_CODE    = String(p.coupon_code);
    }

    return cfg;
  } catch (e) {
    console.warn("[bootstrap] Falha ao ler YAML:", e?.message || e);
    return {};
  }
}

export default { loadBotConfig };
