// configs/bots/claudia/flow/offer.js
// Oferta completa: preços (197/170/150), cobertura COD por CEP+Cidade, coleta de dados, recap, (opcional) webhook Logzz,
// e fallback Coinzz (R$170) com checkout 100% seguro + frete grátis.
// Mantém carimbos via meta.tag (visíveis se settings.flags.debug_labels=true no index).

import { normalizeSettings, tagReply } from "./_state.js";
import { recall, remember } from "../../../../src/core/memory.js";

// ===================== Regex e utilitários =====================
const RX = {
  PRICE: /(preç|valor|quanto|cust)/i,
  LINK: /\b(link|checkout|compr(ar|a)|finaliza(r)?|carrinho|pagamento)\b/i,
  YES: /\b(sim|s|claro|quero|pode|ok|isso|mandar|envia|envie)\b/i,
  NO: /\b(n[ãa]o|nao|depois|agora n[ãa]o)\b/i,
  OBJECTION_SAFETY: /\b(anvisa|seguran[çc]a|golpe|fraude|registro)\b/i,
  OBJECTION_PRICE: /\b(caro|caro demais|muito caro|car[ao])\b/i,

  // Parsers
  PHONE: /(\+?\d{2}\s*)?(\(?\d{2}\)?\s*)?\d{4,5}[-\s.]?\d{4}/,
  CEP: /(\d{5})[-\s.]?(\d{3})/,
  NUMBER: /\b(n[úu]mero|nº|no\.?|num\.?)\s*[:\-]?\s*(\d{1,6})\b|\b(\d{1,6})(?:\s*(?:,|\-|\/)?\s*(?:casa|res|resid|n[úu]mero))?/i,
  APT: /\b(ap(?:to)?\.?\s*\d{1,5}|apartamento\s*\d{1,5}|bloco\s*\w+\s*apto\s*\d{1,5})/i,
  REF: /\b(ref(?:er[êe]ncia)?[:\-]?\s*[^\n]{3,})/i,
  CITY_FALLBACK: /([a-záàâãéêíóôõúüç ]{3,})(?:\/[a-z]{2})?$/i
};

const FLOW = {
  ASK_CEP_CITY: "offer.ask_cep_city",
  COLLECT_NAME: "offer.collect_name",
  COLLECT_PHONE: "offer.collect_phone",
  COLLECT_NUMBER: "offer.collect_number",
  COLLECT_APTREF: "offer.collect_aptref",
  RECAP: "offer.recap",
  CONFIRMING: "offer.confirming",
  COVERAGE_OK: "offer.coverage_ok",
  COVERAGE_BLOCKED: "offer.coverage_blocked",
};

// Helpers básicos
function onlyDigits(s) { return String(s || "").replace(/\D+/g, ""); }
function normCEP(s = "") {
  const m = String(s).match(RX.CEP);
  return m ? `${m[1]}-${m[2]}` : "";
}
function normPhone(s = "") {
  const d = onlyDigits(s);
  if (d.length < 10) return "";
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
}
function guessCity(s = "") {
  const parts = String(s).split(/[,\n]/).map(x=>x.trim()).filter(Boolean);
  const tail = parts[parts.length - 1] || s;
  const m = tail.match(RX.CITY_FALLBACK);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}
function firstName(full = "") {
  const p = String(full).trim().split(/\s+/);
  return p[0] || "";
}
function tag(text, tagId) { return tagReply({}, text, tagId); }

// ===================== Cobertura (arquivo JSON) =====================
let _coverageCache = null;
async function loadCoverage() {
  if (_coverageCache) return _coverageCache;
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile("/app/configs/coverage/claudia-coverage.json", "utf8");
    _coverageCache = JSON.parse(raw);
  } catch {
    _coverageCache = { schema: 1, default_policy: "deny", cities: [] };
  }
  return _coverageCache;
}

function cepMatch(cep, rule) {
  if (!rule) return false;
  if (rule.includes("..")) {
    const [a, b] = rule.split("..");
    const ca = onlyDigits(a), cb = onlyDigits(b), cx = onlyDigits(cep);
    return ca.length===8 && cb.length===8 && cx.length===8 && cx >= ca && cx <= cb;
  }
  if (rule.includes("*")) {
    const re = new RegExp("^" + rule.replace(/\*/g, "\\d").replace("-", "\\-") + "$");
    return re.test(cep);
  }
  return cep === rule;
}
function findCityEntry(cov, cityName) {
  if (!cityName) return null;
  const q = cityName.toLowerCase();
  for (const c of cov.cities || []) {
    if (!c) continue;
    if (String(c.name||"").toLowerCase() === q) return c;
    if (Array.isArray(c.alias) && c.alias.some(a => String(a).toLowerCase() === q)) return c;
  }
  return null;
}
function checkCoverage(cov, city, cep) {
  const entry = findCityEntry(cov, city);
  if (!entry) return { ok: false, reason: "city_not_found" };
  if (String(entry.policy||"deny").toLowerCase() !== "allow") return { ok: false, reason: "city_policy_deny" };
  const deny = Array.isArray(entry.deny_ceps) ? entry.deny_ceps : [];
  for (const r of deny) if (cepMatch(cep, r)) return { ok: false, reason: "cep_blocked", rule: r };
  return { ok: true };
}

// ===================== Persistência da coleta =====================
function ensureCheckout(state) {
  state.checkout = state.checkout || {
    cep: "", city: "", name: "", phone: "", number: "", apt: "", reference: "",
    price: 0, method: "", coverage: null
  };
  return state.checkout;
}
function fillIfPresent(str = "", state) {
  const ck = ensureCheckout(state);
  const cep = normCEP(str); if (cep && !ck.cep) ck.cep = cep;
  const city = guessCity(str); if (city && !ck.city) ck.city = city;
  const pM = str.match(RX.PHONE); if (pM && !ck.phone) ck.phone = normPhone(pM[0]);
  const nM = str.match(RX.NUMBER); if (nM && !ck.number) ck.number = (nM[2] || nM[3] || "").trim();
  const aM = str.match(RX.APT); if (aM && !ck.apt) ck.apt = aM[0].replace(/\s+/g, " ").trim();
  const rM = str.match(RX.REF); if (rM && !ck.reference) ck.reference = rM[0].replace(/^ref(er[êe]ncia)?[:\-]?\s*/i,"").trim();

  // nome (heurística simples): 2+ palavras alfabéticas
  const nameGuess = str.split(/\s+/).filter(w => /^[A-Za-zÁ-ÿ]{2,}$/.test(w)).slice(0, 6).join(" ");
  if (nameGuess && nameGuess.split(" ").length >= 2 && !ck.name) ck.name = nameGuess;
}
function want(field, state) {
  const ck = ensureCheckout(state);
  if (field === "cep_city") return (!ck.cep || !ck.city);
  if (field === "name") return !ck.name;
  if (field === "phone") return !ck.phone;
  if (field === "number") return !ck.number;
  if (field === "aptref") return (!ck.apt && !ck.reference);
  if (field === "recap") return (ck.cep && ck.city && ck.name && ck.phone && ck.number);
  return false;
}
function recapText(ck) {
  return [
    `📌 Nome: **${ck.name || "-"}**`,
    `📌 Telefone: **${ck.phone || "-"}**`,
    `📌 Endereço: **CEP ${ck.cep || "-"}, nº ${ck.number || "-"}${ck.apt ? ", " + ck.apt : ""}**`,
    `📌 Referência: **${ck.reference || "-"}**`
  ].join("\n");
}

// ===================== Webhook Logzz (opcional) =====================
async function postToLogzz(S, payload = {}) {
  try {
    const url = S?.integrations?.logzz?.webhook_url || "";
    const token = S?.integrations?.logzz?.token || "";
    if (!url) return { ok: false, skipped: true, reason: "no_url" };
    const headers = { "content-type": "application/json" };
    if (token) headers["authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ===================== Flow principal =====================
export default async function offer(ctx = {}) {
  const { jid = "", state = {}, text = "", settings = {} } = ctx;
  const S = normalizeSettings(settings);
  const t = String(text || "").trim();
  const lower = t.toLowerCase();

  // Se cliente despejar vários dados, tenta capturar o que der:
  fillIfPresent(t, state);

  // 0) Objeções comuns
  if (RX.OBJECTION_SAFETY.test(lower)) {
    const msg = `Pode ficar tranquila 💚 Nossa Progressiva Vegetal é **100% livre de formol**, regularizada e segura, com mais de **${S?.marketing?.sold_count || 40000}** clientes satisfeitas. ` +
                `E o melhor: o pagamento é **somente na entrega (COD)**, direto ao entregador. Aceitamos **cartões** e até **${S?.payments?.installments_max || 12}x** *(juros dependem da bandeira)*.`;
    return tag(msg, "flow/offer#objection_safety");
  }
  if (RX.OBJECTION_PRICE.test(lower)) {
    const msg = `Entendo 👍 Comparando com salão, sai bem mais em conta e você faz em casa no seu tempo.\n` +
                `Hoje de **R$ ${S.product.price_original},00** por **R$ ${S.product.price_target},00** — e tenho **${S.product.promo_day_quota || 5} unidades do dia a R$ ${S.product.price_promo_day},00**.\n` +
                `Quer que eu verifique o **R$ ${S.product.price_promo_day},00** no seu endereço com **pagamento só na entrega**?`;
    return tag(msg, "flow/offer#objection_price");
  }

  // 1) Preço / Link
  if (RX.PRICE.test(lower)) {
    state.stage = FLOW.ASK_CEP_CITY;
    const msg = `Ótima pergunta 💚\n` +
      `- Preço cheio: **R$ ${S.product.price_original},00**\n` +
      `- Promo do dia: **R$ ${S.product.price_target},00**\n` +
      `- E temos **${S.product.promo_day_quota || 5} unidades relâmpago por R$ ${S.product.price_promo_day},00** 🎉\n\n` +
      `Quer que eu verifique se a condição de **R$ ${S.product.price_promo_day},00** está liberada pra você, com **pagamento só na entrega**? ` +
      `A entrega é rápida: **até ${S.product.delivery_sla.capitals_hours}h nas capitais** e **até ${S.product.delivery_sla.others_hours}h nas demais localidades**.`;
    return tag(msg, "flow/offer#price");
  }
  if (RX.LINK.test(lower)) {
    const msg = `Aqui está o link seguro para finalizar pelo site oficial:\n${S.product.checkout_link}`;
    return tag(msg, "flow/offer#link");
  }

  // 2) Caminho R$150 → pedir CEP + Cidade
  if (state.stage === FLOW.ASK_CEP_CITY || want("cep_city", state)) {
    const ck = ensureCheckout(state);

    if (!ck.cep) {
      state.stage = FLOW.ASK_CEP_CITY;
      return tag(`Pode me enviar o seu **CEP** (ex.: 00000-000) e a **cidade**? · [Precisamos checar a cobertura do COD R$ ${S.product.price_promo_day}]`, "flow/offer#ask_cep_city");
    }
    if (!ck.city) {
      state.stage = FLOW.ASK_CEP_CITY;
      return tag(`Obrigada! Agora me diga a **cidade** (ex.: Brasília/DF).`, "flow/offer#ask_city");
    }

    // Checar cobertura
    const cov = await loadCoverage();
    const res = checkCoverage(cov, ck.city, ck.cep);
    ck.coverage = res;

    if (res.ok) {
      ck.price = Number(S.product.price_promo_day || 150);
      ck.method = "COD";
      state.stage = FLOW.COLLECT_NAME;
      return tag(
        `Perfeito! Esse endereço tem **R$ ${ck.price},00 no pagamento na entrega (COD)** ✅\n` +
        `Pra registrar, me confirma seu **nome completo**, por favor.`,
        "flow/offer#coverage_ok"
      );
    }

    // Fora da cobertura
    state.stage = FLOW.COVERAGE_BLOCKED;

    if (res.reason === "city_not_found" || res.reason === "city_policy_deny") {
      return tag(
        `Infelizmente ainda não conseguimos atender a sua região com o pagamento na entrega 😕\n` +
        `Mas não te deixo na mão 💚 Você pode receber pelos **Correios com frete grátis**, valor de **R$ ${S?.fallback?.prepaid_price || 170},00**, ` +
        `via checkout **100% seguro** no nosso parceiro **${S?.fallback?.prepaid_partner || "Coinzz"}**.\n` +
        `Quer que eu te envie o **link oficial** pra finalizar?`,
        "flow/offer#city_not_covered"
      );
    }

    // Cidade atendida mas CEP bloqueado
    const fp = Number(S?.fallback?.prepaid_price || S.product.price_target || 170);
    return tag(
      `Para esse endereço o **pagamento na entrega (COD)** não está disponível 😕\n` +
      `Mas consigo te atender por **R$ ${fp},00** com **frete grátis pelos Correios**, via parceiro **${S?.fallback?.prepaid_partner || "Coinzz"}** (checkout 100% seguro).\n` +
      `Quer que eu te envie o **link oficial** agora pra finalizar?`,
      "flow/offer#coverage_blocked"
    );
  }

  // 3) Fallback Coinzz quando coverage bloqueado
  if (state.stage === FLOW.COVERAGE_BLOCKED) {
    if (RX.YES.test(lower)) {
      const link = S?.fallback?.prepaid_link || S.product.checkout_link;
      const price = Number(S?.fallback?.prepaid_price || S.product.price_target || 170);
      state.stage = null;
      return tag(
        `Aqui está: ${link}\n` +
        `Checkout **100% seguro** pelo ${S?.fallback?.prepaid_partner || "parceiro"}, valor **R$ ${price},00**, com **frete grátis pelos Correios**.`,
        "flow/offer#prepaid_link"
      );
    }
    if (RX.NO.test(lower)) {
      state.stage = null;
      return tag(`Sem problema 💚 Posso te mandar mais detalhes do produto ou retomamos quando preferir.`, "flow/offer#prepaid_declined");
    }
    return tag(
      `Quer receber o **link oficial** (${S?.fallback?.prepaid_partner || "Coinzz"}) para finalizar por **R$ ${S?.fallback?.prepaid_price || S.product.price_target},00** com **frete grátis pelos Correios**?`,
      "flow/offer#prepaid_offer_repeat"
    );
  }

  // 4) Coleta ordenada (quando coverage ok)
  const ck = ensureCheckout(state);

  if (state.stage === FLOW.COLLECT_NAME || want("name", state)) {
    if (!ck.name) {
      state.stage = FLOW.COLLECT_NAME;
      return tag(`Perfeito 💚 Me diga seu **nome completo**, por favor.`, "flow/offer#address_name");
    }
    state.stage = FLOW.COLLECT_PHONE;
  }

  if (state.stage === FLOW.COLLECT_PHONE || want("phone", state)) {
    if (!ck.phone) {
      state.stage = FLOW.COLLECT_PHONE;
      return tag(`Obrigado, ${firstName(ck.name)}! Agora o seu **telefone com DDD** (ex.: (61) 9XXXX-XXXX).`, "flow/offer#address_phone");
    }
    state.stage = FLOW.COLLECT_NUMBER;
  }

  if (state.stage === FLOW.COLLECT_NUMBER || want("number", state)) {
    if (!ck.number) {
      state.stage = FLOW.COLLECT_NUMBER;
      return tag(`Anotado. Qual o **número da residência**?`, "flow/offer#address_number");
    }
    state.stage = FLOW.COLLECT_APTREF;
  }

  if (state.stage === FLOW.COLLECT_APTREF || want("aptref", state)) {
    if (!ck.apt && !ck.reference) {
      state.stage = FLOW.COLLECT_APTREF;
      return tag(`Tem **apartamento** (bloco/apto)? E algum **ponto de referência** que ajude o entregador? (Se não tiver, pode dizer "não")`, "flow/offer#address_aptref");
    }
    state.stage = FLOW.RECAP;
  }

  // === RECAP (confirmação de dados) ===
  if (state.stage === FLOW.RECAP || want("recap", state)) {
    const rec = recapText(ck);
    state.stage = FLOW.CONFIRMING;
    return tag(
      `Perfeito${ck.name ? `, ${firstName(ck.name)}` : ""}! Só pra garantir que anotei **tudo certinho**:\n` +
      `${rec}\n\n` +
      `Está **correto**? Se quiser ajustar algo, me diga o que mudar (ex.: “trocar telefone” ou “sem referência”).`,
      "flow/offer#recap"
    );
  }

  // === CONFIRMING (CTA final COD) ===
  if (state.stage === FLOW.CONFIRMING) {
    if (RX.YES.test(lower)) {
      try { await remember(jid, { checkout: ck }); } catch {}
      let logzzOk = false;
      if (S?.integrations?.logzz?.webhook_url) {
        const payload = {
          customer: { name: ck.name, phone: ck.phone },
          address: { cep: ck.cep, city: ck.city, number: ck.number, apt: ck.apt, reference: ck.reference },
          value: ck.price || Number(S.product.price_promo_day || 150),
          payment: "COD",
          notes: "Promo do dia via WhatsApp",
          jid
        };
        const res = await postToLogzz(S, payload);
        logzzOk = !!res?.ok;
      }

      const prazoCap = S.product?.delivery_sla?.capitals_hours || 24;
      const prazoOut = S.product?.delivery_sla?.others_hours || 72;
      const parcelas = S?.payments?.installments_max || 12;

      state.stage = null;
      return tag(
        (logzzOk
          ? `Pedido **registrado** 🎉 `
          : `Tudo certo com seus dados 💚 `) +
        `${ck.name ? `${firstName(ck.name)}, ` : ""}o **entregador** vai te chamar no WhatsApp para combinar o melhor horário.\n\n` +
        `• **Pagamento só na entrega (COD)** — direto com o entregador\n` +
        `• Aceitamos **cartões** e parcelamos em até **${parcelas}x** *(eventual juros depende da bandeira)*\n` +
        `• Prazo de entrega: **até ${prazoCap}h** em capitais e **até ${prazoOut}h** nas demais localidades\n\n` +
        `Qualquer dúvida, fico aqui com você 💚`,
        "flow/offer#confirmed_cod"
      );
    }

    if (RX.NO.test(lower)) {
      state.stage = FLOW.RECAP;
      return tag(`Claro! Me diga o que precisa ajustar (ex.: “corrigir telefone”, “nº da casa é 152”, “sem referência”).`, "flow/offer#recap_edit");
    }

    const rec = recapText(ck);
    return tag(
      `Confere pra mim:\n${rec}\n\nPosso **registrar agora** e pedir pro entregador te chamar no WhatsApp?`,
      "flow/offer#recap_repeat"
    );
  }

  // 5) Fallback genérico
  state.stage = FLOW.ASK_CEP_CITY;
  return tag(
    `A Progressiva Vegetal serve para **todos os tipos de cabelo** e **hidrata profundamente enquanto alinha**.\n` +
    `Hoje temos: **R$ ${S.product.price_original},00**, **R$ ${S.product.price_target},00**, e **R$ ${S.product.price_promo_day},00** (COD mediante cobertura).\n` +
    `Quer que eu verifique o **R$ ${S.product.price_promo_day},00** com **pagamento só na entrega**?\n` +
    `Entregas em **até ${S.product.delivery_sla.capitals_hours}h** nas capitais e **até ${S.product.delivery_sla.others_hours}h** nas demais.`,
    "flow/offer#fallback"
  );
}
