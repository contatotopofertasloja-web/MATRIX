// configs/bots/claudia/flow/postsale.js
// Pós-venda da Cláudia (pagamento confirmado, confirmação de pedido, dicas rápidas e cupom opcional)
// Agora integrado à memória unificada (recall/remember) para personalização.

import { settings } from "../../../../src/core/settings.js";
import { setStage } from "../../../../src/core/fsm.js";
import { recall, remember } from "../../../../src/core/memory.js";
import { callUser } from "./_state.js";

function linesToText(lines = []) {
  return (lines || [])
    .map((l) => String(l || "").trim())
    .filter(Boolean)
    .join("\n");
}

export async function postsale({ userId, text = "", event = "paid" }) {
  await setStage(userId, "postsale");

  const msgs = [];
  const msgBlock = settings?.messages || {};
  const product = settings?.product || {};

  // carrega profile persistente
  let profile = {};
  try {
    const saved = await recall(userId);
    if (saved?.profile) {
      profile = saved.profile;
    }
  } catch (e) {
    console.warn("[postsale.recall]", e?.message);
  }

  const name = callUser({ profile });

  // 1) pacote "pago com sucesso"
  const pre = Array.isArray(msgBlock.postsale_pre_coupon)
    ? msgBlock.postsale_pre_coupon
    : [];

  if (pre.length) {
    msgs.push(linesToText(pre));
  } else {
    msgs.push(
      `Pagamento confirmado${name ? ", " + name : ""}! 🎉 Você receberá mensagens pelo WhatsApp para agendar e acompanhar a entrega.`,
      "Se pintar qualquer imprevisto com o horário, é só avisar o entregador pelo próprio WhatsApp. 💚"
    );
  }

  // 2) cupom (apenas se configurado para aparecer após pagamento)
  const canCoupon =
    !!product?.coupon_post_payment_only && !!product?.coupon_code;
  const tpl = (Array.isArray(msgBlock.postsale_after_payment_with_coupon)
    ? msgBlock.postsale_after_payment_with_coupon
    : []
  )
    .map((t) =>
      String(t || "").replace(
        /\{\{coupon_code\}\}/g,
        String(product.coupon_code || "")
      )
    )
    .filter((t) => t.trim());

  if (canCoupon && tpl.length) {
    msgs.push(tpl[0]);
  }

  // 3) lembrete de acompanhamento (apenas informativo aqui)
  const days = Number(settings?.messages?.postsale_followup_days || 0);
  if (Number.isFinite(days) && days > 0) {
    msgs.push(
      `Daqui a ${days} dia${days > 1 ? "s" : ""} eu te mando um lembrete com dicas rápidas de aplicação e manutenção ✨`
    );
  }

  // salva que já entrou em pós-venda
  try {
    await remember(userId, { profile, stage: "postsale" });
  } catch (e) {
    console.warn("[postsale.remember]", e?.message);
  }

  return linesToText(msgs);
}

export default postsale;
