// configs/bots/claudia/flow/postsale.js
import { callUser, tagReply } from "./_state.js";

export default async function postsale(ctx) {
  const { settings, state } = ctx;
  state.turns = (state.turns || 0) + 1;

  const lines = [];
  const pre = settings?.messages?.postsale_pre_coupon || [];
  for (const l of pre) lines.push(l);

  if (settings?.product?.coupon_post_payment_only && settings?.product?.coupon_code) {
    const tpl = settings?.messages?.postsale_after_payment_with_coupon?.[0] || "";
    const txt = tpl.replace("{{coupon_code}}", settings.product.coupon_code);
    if (txt) lines.push(txt);
  }

  const sla = settings?.product?.delivery_sla || {};
  const infoPrazo =
    (settings?.messages?.delivery_info?.[0] || "")
      .replace("{{delivery_sla.capitals_hours}}", String(sla.capitals_hours ?? ""))
      .replace("{{delivery_sla.others_hours}}", String(sla.others_hours ?? ""));
  if (infoPrazo.trim()) lines.push(infoPrazo);

  const introFeat = settings?.messages?.features_intro?.[0];
  const how = (settings?.product?.how_to_use || "").trim();
  if (introFeat && how) { lines.push(introFeat); lines.push(how); }

  const reply = lines.length
    ? lines.join("\n")
    : `Pedido confirmado, ${callUser(state)}! Você vai receber as atualizações por aqui. Qualquer dúvida, me chama 💛`;

  return { reply: tagReply(settings, reply, "flow/postsale"), next: "posvenda" };
}
