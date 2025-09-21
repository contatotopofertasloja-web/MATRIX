// configs/bots/claudia/flow/postsale.js
// Confirmação + informações úteis após o envio do checkout (V1).
// Usa mensagens/SLAs e "como usar" do settings.yaml.

import { callUser, tagReply, getFixed } from "./_state.js";

function buildDeliveryInfo(settings) {
  const sla = settings?.product?.delivery_sla || {};
  const tpl = (settings?.messages?.delivery_info?.[0] || "")
    .replace("{{delivery_sla.capitals_hours}}", String(sla.capitals_hours ?? ""))
    .replace("{{delivery_sla.others_hours}}", String(sla.others_hours ?? ""));
  return tpl.trim();
}

function buildHowToUse(settings) {
  const intro = settings?.messages?.features_intro?.[0];
  const how   = (settings?.product?.how_to_use || "").trim();
  if (intro && how) return `${intro}\n${how}`;
  return how || "";
}

function maybeRaffleTeaser(settings) {
  const raffle = settings?.promotions?.raffle;
  if (raffle?.enabled && raffle?.teaser) return raffle.teaser;
  return "";
}

export default async function postsale(ctx) {
  const { settings, state } = ctx;
  state.turns = (state.turns || 0) + 1;

  const fx = getFixed(settings);
  const name = callUser(state);

  const lines = [];

  // Abertura amigável (com ou sem templates específicos no YAML)
  const pre = settings?.messages?.postsale_pre_coupon || [];
  if (pre.length) {
    lines.push(...pre);
  } else {
    lines.push(
      `Pedido confirmado${name ? `, ${name}` : ""}!`,
      `Preço final: **R$${fx.priceTarget}** · Forma: **COD (paga na entrega)**.`
    );
  }

  // Se houver política de cupom pós-pagamento, envia mensagem configurada
  if (settings?.product?.coupon_post_payment_only && settings?.product?.coupon_code) {
    const tpl = settings?.messages?.postsale_after_payment_with_coupon?.[0] || "";
    const txt = tpl.replace("{{coupon_code}}", settings.product.coupon_code);
    if (txt) lines.push(txt);
  }

  // Prazo de entrega (do YAML)
  const infoPrazo = buildDeliveryInfo(settings);
  if (infoPrazo) lines.push(infoPrazo);

  // Como usar (resumo) se disponível
  const how = buildHowToUse(settings);
  if (how) lines.push(how);

  // Teaser opcional (sorteio/promo, se ligado no YAML)
  const teaser = maybeRaffleTeaser(settings);
  if (teaser) lines.push(teaser);

  // Fallback final
  const reply = lines.length
    ? lines.join("\n")
    : `Pedido confirmado, ${name || "tudo certo"}! Você vai receber as atualizações por aqui. Qualquer dúvida, me chama 💛`;

  // Encaminha para etapa de pós-venda (seguimento, tracking etc.)
  return { reply: tagReply(settings, reply, "flow/postsale"), next: "posvenda" };
}
