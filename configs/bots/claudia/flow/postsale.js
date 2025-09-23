// configs/bots/claudia/flow/postsale.js
// Pós-venda (V2): confirma pedido, reforça COD e prazos, envia modo de uso,
// trata gatilhos "paguei/recebi", cupom pós-pagamento (quando houver) e teaser de sorteio.
// Mantém compat com helpers do projeto e com mensagens do settings.yaml.
//
// ctx esperado: { settings, state, outbox, jid, text }
// helpers: callUser(state), tagReply(settings, text, stamp), getFixed(settings)
// configs/bots/claudia/flow/postsale.js
import { settings } from '../../../src/core/settings.js';

export default function postsale() {
  const coupon = settings?.product?.coupon_code || '';
  const cupomMsg = coupon ? ` Como agradecimento, cupom para a PRÓXIMA compra: ${coupon}.` : '';
  return `Pagamento confirmado! Você receberá mensagens para acompanhar a entrega. Dúvidas no uso? Posso te mandar a rotina. ${cupomMsg} (flow/postsale)`;
}

import { callUser, tagReply, getFixed } from "./_state.js";

// --------- helpers de conteúdo extraído do settings ----------
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

function maybeCouponMsg(settings) {
  if (settings?.product?.coupon_post_payment_only && settings?.product?.coupon_code) {
    const tpl = settings?.messages?.postsale_after_payment_with_coupon?.[0] || "";
    return tpl.replace("{{coupon_code}}", settings.product.coupon_code).trim();
  }
  return "";
}

// Failsafe: envia a foto de abertura 1x (caso o fluxo tenha começado em oferta/fechamento)
async function ensureOpeningPhotoOnce(ctx) {
  const { settings, state, outbox, jid } = ctx;
  if (
    settings?.flags?.send_opening_photo &&
    settings?.media?.opening_photo_url &&
    !state.__sent_opening_photo
  ) {
    await outbox.publish({
      to: jid,
      kind: "image",
      payload: { url: settings.media.opening_photo_url, caption: "" },
    });
    state.__sent_opening_photo = true;
  }
}

// --------- detecção de intenções simples no pós-venda ----------
const RX = {
  PAID:    /\b(paguei|pago|pagamento\s*feito|paguei\s*agora|finalizei|comprovante)\b/i,
  RECEIVED:/\b(recebi|chegou|entregue|entrega\s*realizada)\b/i,
  HOWTO:   /\b(como\s*usa|modo\s*de\s*uso|aplicar|aplica[cç][aã]o|chapinha|escova|passo\s*a\s*passo)\b/i,
  THANKS:  /\b(obrigad[ao]|valeu|perfeito|deu\s*certo)\b/i,
};

// --------- principal ----------
export default async function postsale(ctx) {
  const { settings, state, text = "" } = ctx;

  state.turns = (state.turns || 0) + 1;

  // Failsafe de mídia (opcional, 1x)
  await ensureOpeningPhotoOnce(ctx);

  const fx    = getFixed(settings); // priceTarget etc.
  const name  = callUser(state);
  const lines = [];

  const saidPaid     = RX.PAID.test(text);
  const saidReceived = RX.RECEIVED.test(text);
  const askedHowTo   = RX.HOWTO.test(text);
  const thanked      = RX.THANKS.test(text);

  // 0) mensagens padrão do YAML (se definidas)
  const pre = settings?.messages?.postsale_pre_coupon || [];
  const deliveryInfo = buildDeliveryInfo(settings);
  const howToUse     = buildHowToUse(settings);
  const raffleTeaser = maybeRaffleTeaser(settings);
  const couponMsg    = maybeCouponMsg(settings);

  // 1) Se o cliente sinaliza que PAGOU → agradece, confirma e (se houver) envia cupom pós-pagamento
  if (saidPaid) {
    state.paid_confirmed_at = Date.now();
    if (pre.length) lines.push(...pre);
    else lines.push(
      `Pagamento confirmado${name ? `, ${name}` : ""}! 🎉`,
      `Forma: **COD (paga na entrega)** · Condição final: **R$${fx.priceTarget}**.`
    );

    if (couponMsg && !state.__coupon_sent) {
      lines.push(couponMsg);
      state.__coupon_sent = true;
    }

    if (deliveryInfo) lines.push(deliveryInfo);
    if (howToUse)     lines.push(howToUse);
    if (raffleTeaser) lines.push(raffleTeaser);

    // Encaminha para etapa de acompanhamento
    return { reply: tagReply(settings, lines.join("\n"), "flow/postsale#paid"), next: "posvenda" };
  }

  // 2) Se o cliente diz que RECEBEU → manda modo de uso e reforça canal de suporte
  if (saidReceived) {
    lines.push(
      `Que bom que chegou${name ? `, ${name}` : ""}! 🙌 Qualquer coisa, fala comigo por aqui.`,
    );
    if (howToUse) lines.push(howToUse);
    if (raffleTeaser) lines.push(raffleTeaser);

    return { reply: tagReply(settings, lines.join("\n"), "flow/postsale#received"), next: "posvenda" };
  }

  // 3) Se o cliente pede COMO USAR em qualquer momento
  if (askedHowTo) {
    if (howToUse) {
      lines.push(howToUse);
    } else {
      lines.push(
        "Te passo o passo a passo resumido:",
        "1) Aplicar mecha a mecha e deixar agir **40–50 min**;",
        "2) Enxaguar e **finalizar com escova/chapinha** para selar;",
        "3) Resultado médio: **até 3 meses** (varia por cabelo e rotina)."
      );
    }
    return { reply: tagReply(settings, lines.join("\n"), "flow/postsale#howto"), next: "posvenda" };
  }

  // 4) Agradecimentos simples → reforça status + CTA leve
  if (thanked) {
    lines.push(`Eu que agradeço${name ? `, ${name}` : ""}! 💛`);
    if (deliveryInfo) lines.push(deliveryInfo);
    lines.push("Se quiser, te lembro do modo de uso no dia da aplicação. Posso te enviar o resumo agora?");
    return { reply: tagReply(settings, lines.join("\n"), "flow/postsale#thanks"), next: "posvenda" };
  }

  // 5) Default (quando chamado logo após envio do checkout/fechamento)
  if (pre.length) {
    lines.push(...pre);
  } else {
    lines.push(
      `Pedido confirmado${name ? `, ${name}` : ""}!`,
      `Preço final: **R$${fx.priceTarget}** · Forma: **COD (paga na entrega)**.`
    );
  }

  if (deliveryInfo) lines.push(deliveryInfo);
  if (howToUse)     lines.push(howToUse);
  if (raffleTeaser) lines.push(raffleTeaser);

  // Encaminha para trilha de acompanhamento contínuo
  return { reply: tagReply(settings, lines.join("\n"), "flow/postsale#default"), next: "posvenda" };
}
