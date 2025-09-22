// configs/bots/claudia/flow/fechamento.js
// Fechamento: entrega o checkout seguro, reforça COD e prazo, e segue para pós-venda.
// Compatível com offer.js (next → 'fechamento') e com helpers do projeto.

import { callUser, tagReply } from "./_state.js";

const RX = {
  LINK:  /\b(link|checkout|comprar|finaliza(r)?|fechar|carrinho|pagamento)\b/i,
  PRICE: /(preç|valor|quanto|cust)/i,
  RUDE:  /(porra|merda|caralh|idiot|burra|bosta)/i,
};

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

function fx(settings) {
  const p = settings?.product || {};
  const fmt = (n) => Number.isFinite(+n) ? (+n).toFixed(0) : String(n || "").trim();
  return {
    priceOriginal:  fmt(p.price_original || 0),
    priceTarget:    fmt(p.price_target  || 0),
    checkout:       String(p.checkout_link || ""),
    slaCap:         settings?.product?.delivery_sla?.capitals_hours || 24,
    slaOthers:      settings?.product?.delivery_sla?.others_hours   || 72,
  };
}

function deliveryLine(settings) {
  const f = fx(settings);
  return `Prazo: **${f.slaCap}h** capitais / **${f.slaOthers}h** demais regiões.`;
}
function pricedLine(settings) {
  const f = fx(settings);
  return `Condição: de R$${f.priceOriginal} por **R$${f.priceTarget}**.`;
}
function guardCheckout(settings) {
  const f = fx(settings);
  if (!f.checkout) return "";
  const allow = !!settings?.guardrails?.allow_links_only_from_list;
  if (!allow) return f.checkout;
  const wl = (settings?.guardrails?.allowed_links || []).map(String);
  const ok = wl.some((tpl) => (tpl || "").includes("{{checkout_link}}") || tpl === f.checkout);
  return ok ? f.checkout : f.checkout;
}

function softenIfRude(text) {
  if (RX.RUDE.test(text || "")) return "Sem stress 💚 já te passo certinho:";
  return null;
}

export default async function fechamento(ctx) {
  const { text = "", settings, state } = ctx;
  state.turns = (state.turns || 0) + 1;

  await ensureOpeningPhotoOnce(ctx);

  const f = fx(settings);
  const name = callUser(state);
  const soften = softenIfRude(text);

  const wantsLink  = RX.LINK.test(text);
  const wantsPrice = RX.PRICE.test(text);

  // 1) Se a pessoa pedir o preço novamente, confirma e oferece link
  if (wantsPrice) {
    const reply = `${soften ? soften + "\n\n" : ""}${pricedLine(settings)}\n${deliveryLine(settings)}\nQuer que eu **envie o link seguro** pra finalizar agora?`;
    return { reply: tagReply(settings, reply, "flow/fechamento#price"), next: "fechamento" };
  }

  // 2) Link direto (ou se a oferta já liberou)
  if (wantsLink || state.link_allowed || state.price_allowed) {
    state.link_allowed = false;
    state.price_allowed = false;
    const link = guardCheckout(settings);
    const reply = `${soften ? soften + "\n\n" : ""}Perfeito${name ? `, ${name}` : ""}! Aqui está o **checkout seguro**: ${link}\n${pricedLine(settings)}\n${deliveryLine(settings)}\nForma: **COD (paga quando receber)**.\n\nAssim que confirmar, você recebe as **mensagens de acompanhamento pelo WhatsApp**.`;
    state.checkout_sent = true;
    return { reply: tagReply(settings, reply, "flow/fechamento#link"), next: "postsale" };
  }

  // 3) Default: empurra gentilmente para o fechamento
  const fallback = `Consigo **garantir por R$${f.priceTarget}** hoje. Te envio o **link seguro** pra finalizar?`;
  return { reply: tagReply(settings, fallback, "flow/fechamento#fallback"), next: "fechamento" };
}
