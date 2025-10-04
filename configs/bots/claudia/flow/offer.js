// configs/bots/claudia/flow/offer.js
// Pré-CEP: âncora (R$197) + promo do dia (R$170) → pede Cidade/UF + CEP.
// Cobertura: rota COD (2×197 ou 1×150). Fora de rota: Coinzz (R$170).
// Preços SEMPRE vindos do settings (normalizeSettings). Carimbos preservados.

import { normalizeSettings, tagReply } from "./_state.js";
import { recall, remember } from "../../../../src/core/memory.js";
import path from "node:path";
import fs from "node:fs/promises";

function bubble(text, tag) {
  return tagReply({}, text, tag); // carimbo preservado
}
function REPLY(text, tag) {
  return { replies: [bubble(text, tag)], meta: { tag } };
}

const SAFE = (S) => ({
  original: Number(S?.product?.price_original ?? 197),
  target: Number(S?.product?.price_target ?? 170),
  promoDay: Number(S?.product?.price_promo_day ?? 150),
  quota: Number(S?.product?.promo_day_quota ?? 5),
  capH: Number(S?.product?.delivery_sla?.capitals_hours ?? 24),
  othH: Number(S?.product?.delivery_sla?.others_hours ?? 72),
  prepaidPrice: Number(S?.fallback?.prepaid_price ?? S?.product?.price_target ?? 170),
  partner: S?.fallback?.prepaid_partner || "Coinzz",
  link: S?.fallback?.prepaid_link || S?.product?.checkout_link || ""
});

const RX = {
  PRICE: /(preç|valor|quanto|cust)/i,
  LINK: /\b(link|checkout|compr(ar|a)|finaliza(r)?|carrinho|pagamento)\b/i,
  YES: /\b(sim|s|claro|quero|pode|ok|isso|mandar|envia|envie)\b/i,
  NO: /\b(n[ãa]o|nao|depois|agora n[ãa]o)\b/i,
  OBJECTION_SAFETY: /\b(anvisa|seguran[çc]a|golpe|fraude|registro)\b/i,
  OBJECTION_PRICE: /\b(caro|caro demais|muito caro|car[ao])\b/i,

  PHONE: /(\+?\d{2}\s*)?(\(?\d{2}\)?\s*)?\d{4,5}[-\s.]?\d{4}/,
  CEP: /(\d{5})[-\s.]?(\d{3})/,
  NUMBER: /\b(n[úu]mero|nº|no\.?|num\.?)\s*[:\-]?\s*(\d{1,6})\b|\b(\d{1,6})(?:\s*(?:,|\-|\/)?\s*(?:casa|res|resid|n[úu]mero))?/i,
  APT: /\b(ap(?:to)?\.?\s*\d{1,5}|apartamento\s*\d{1,5}|bloco\s*\w+\s*apto\s*\d{1,5})/i,
  REF: /\b(ref(?:er[êe]ncia)?[:\-]?\s*[^\n]{3,})/i,
  CITY_FALLBACK: /([a-záàâãéêíóôõúüç ]{3,})(?:\/[a-z]{2})?$/i,

  CHOOSE_TWO: /\b(2|duas|dois)\b|\bcombo\b|\b197\b/i,
  CHOOSE_ONE: /\b(1|uma|um)\b|\b150\b/i,
};

const FLOW = {
  ASK_CEP_CITY: "offer.ask_cep_city",
  CHOOSE_OFFER: "offer.choose_offer",
  COLLECT_NAME: "offer.collect_name",
  COLLECT_PHONE: "offer.collect_phone",
  COLLECT_NUMBER: "offer.collect_number",
  COLLECT_APTREF: "offer.collect_aptref",
  RECAP: "offer.recap",
  CONFIRMING: "offer.confirming",
  COVERAGE_OK: "offer.coverage_ok",
  COVERAGE_BLOCKED: "offer.coverage_blocked",
};

// Helpers
const onlyDigits = (s) => String(s || "").replace(/\D+/g, "");
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
const firstName = (full = "") => (String(full).trim().split(/\s+/)[0] || "");

// Cobertura JSON — tenta múltiplos caminhos até encontrar
let _coverageCache = null;
async function loadCoverage() {
  if (_coverageCache) return _coverageCache;
  const CANDIDATES = [
    path.resolve(process.cwd(), "configs/coverage/claudia-coverage.json"),
    path.resolve(process.cwd(), "configs/coverage/claudia-coverage.json".replace(".json",".txt")),
    path.resolve("configs/coverage/claudia-coverage.json"),
  ];
  for (const p of CANDIDATES) {
    try {
      const raw = await fs.readFile(p, "utf8");
      _coverageCache = JSON.parse(raw);
      return _coverageCache;
    } catch {}
  }
  _coverageCache = { schema: 1, default_policy: "deny", cities: [] };
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
  for (const c of (cov.cities || [])) {
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

// Persistência
function ensureCheckout(state) {
  state.checkout = state.checkout || {
    cep: "", city: "", name: "", phone: "", number: "", apt: "", reference: "",
    price: 0, units: 1, method: "", coverage: null
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
    `📌 Nome: ${ck.name || "-"}`,
    `📌 Telefone: ${ck.phone || "-"}`,
    `📌 Endereço: CEP ${ck.cep || "-"}, nº ${ck.number || "-"}${ck.apt ? ", " + ck.apt : ""}`,
    `📌 Referência: ${ck.reference || "-"}`
  ].join("\n");
}

// Webhook Logzz (opcional) — chamar só APÓS ratificação
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

export default async function offer(ctx = {}) {
  const { jid = "", state = {}, text = "", settings = {} } = ctx;
  const S = normalizeSettings(settings);
  const P = SAFE(S);

  const t = String(text || "").trim();
  const lower = t.toLowerCase();

  // Capturar dados soltos
  fillIfPresent(t, state);

  // 0) Objeções
  if (RX.OBJECTION_SAFETY.test(lower)) {
    const msg = `Pode ficar tranquila 💚 Nossa Progressiva Vegetal é 100% livre de formol, regularizada e segura, com mais de ${S?.marketing?.sold_count || 40000} clientes satisfeitas.
E o melhor: pagamento somente na entrega (COD), direto ao entregador. Aceitamos cartões e parcelamos em até ${S?.payments?.installments_max || 12}x.`;
    return REPLY(msg, "flow/offer#objection_safety");
  }
  if (RX.OBJECTION_PRICE.test(lower)) {
    const msg = `Entendo 👍 Comparando com salão, sai bem mais em conta e você faz em casa no seu tempo.
Hoje trabalhamos a **R$ ${P.original},00** (cheio) com **Promo do Dia por R$ ${P.target},00**.
Posso consultar seu CEP pra ver se libera **promoção especial** com pagamento só na entrega?`;
    return REPLY(msg, "flow/offer#objection_price");
  }

  // 1) Preço / Link (pré-CEP)
  if (RX.PRICE.test(lower)) {
    state.stage = FLOW.ASK_CEP_CITY;
    const msg = `Hoje a nossa condição está assim:
💰 **Preço cheio: R$ ${P.original},00**
🎁 **Promo do dia: R$ ${P.target},00**

Quer que eu **consulte no sistema** se existe **promoção especial** para o seu endereço?
Se sim, me envia **Cidade/UF + CEP** (ex.: São Paulo/SP – 01001-000).`;
    return REPLY(msg, "flow/offer#precheck_special");
  }
  if (RX.LINK.test(lower)) {
    const msg = `Aqui está o link seguro para finalizar pelo site oficial:
${S?.product?.checkout_link || P.link}`;
    return REPLY(msg, "flow/offer#link");
  }

  // 2) Pedir CEP + Cidade (entrada padrão vinda do greet)
  if (state.stage === FLOW.ASK_CEP_CITY || want("cep_city", state)) {
    const ck = ensureCheckout(state);

    // Se ainda não temos CEP nem Cidade, mostrar âncora + promo e pedir ambos
    if (!ck.cep && !ck.city) {
      state.stage = FLOW.ASK_CEP_CITY;
      return REPLY(
        `Hoje a nossa condição está assim:
💰 **Preço cheio: R$ ${P.original},00**
🎁 **Promo do dia: R$ ${P.target},00**

Quer que eu **consulte no sistema** se existe **promoção especial** para o seu endereço?
Me envia **Cidade/UF + CEP** (ex.: **São Paulo/SP – 01001-000**).`,
        "flow/offer#precheck_special"
      );
    }

    if (!ck.cep) {
      state.stage = FLOW.ASK_CEP_CITY;
      return REPLY(`Pode me enviar o seu **CEP** (ex.: 00000-000)?`, "flow/offer#ask_cep_city");
    }
    if (!ck.city) {
      state.stage = FLOW.ASK_CEP_CITY;
      return REPLY(`Obrigada! Agora me diga a **cidade no formato Cidade/UF** (ex.: Brasília/DF).`, "flow/offer#ask_city");
    }

    // Checar cobertura
    const cov = await loadCoverage();
    const res = checkCoverage(cov, ck.city, ck.cep);
    ck.coverage = res;

    if (res.ok) {
      // Libera ofertas COD e enfatiza pagamento só na entrega
      state.stage = FLOW.CHOOSE_OFFER;
      return REPLY(
        `Parabéns 🎉 seu endereço **está na rota** com **pagamento só na entrega (COD)** ✅
Tenho duas opções liberadas pra você:
👉 **2 unidades por R$ 197** (R$ 98,50 cada)
👉 **1 unidade por R$ 150** (*Promo Relâmpago – poucas unidades*)
Qual você prefere que eu **registre agora**?`,
        "flow/offer#release_offers"
      );
    }

    // Fora da cobertura → Coinzz
    state.stage = FLOW.COVERAGE_BLOCKED;

    if (res.reason === "city_not_found" || res.reason === "city_policy_deny") {
      return REPLY(
        `Nesse endereço ainda não temos entrega na hora 😕
Mas não te deixo na mão 💚 Você recebe pelos **Correios com frete grátis** por **R$ ${P.prepaidPrice},00**, via checkout seguro no nosso parceiro **${P.partner}**.
Posso te enviar o **link oficial** pra finalizar?`,
        "flow/offer#city_not_covered"
      );
    }

    return REPLY(
      `Para esse endereço o pagamento na entrega (COD) não está disponível 😕
Consigo te atender por **R$ ${P.prepaidPrice},00** com frete grátis pelos Correios, via **${P.partner}** (checkout seguro).
Quer que eu te envie o link oficial agora pra finalizar?`,
      "flow/offer#coverage_blocked"
    );
  }

  // 3) Escolha de oferta COD (2x197 ou 1x150) → segue coleta
  const ck = ensureCheckout(state);

  if (state.stage === FLOW.CHOOSE_OFFER) {
    if (RX.CHOOSE_TWO.test(lower)) {
      ck.price = 197;
      ck.units = 2;
      ck.method = "COD";
      state.stage = FLOW.COLLECT_NAME;
      return REPLY(`Ótima escolha 👏 (sai **R$ 98,50 cada**). Pra agendar, me confirma seu **nome completo**, por favor.`, "flow/offer#choose_two");
    }
    if (RX.CHOOSE_ONE.test(lower)) {
      ck.price = P.promoDay || 150;
      ck.units = 1;
      ck.method = "COD";
      state.stage = FLOW.COLLECT_NAME;
      return REPLY(`Show! É **promo relâmpago** com poucas unidades. Me diga seu **nome completo**, por favor.`, "flow/offer#choose_one");
    }
    // Repetir opções se não entendeu
    return REPLY(
      `Posso registrar **2 por R$ 197** (R$ 98,50 cada) ou **1 por R$ 150** (relâmpago). Qual prefere?`,
      "flow/offer#choose_offer_repeat"
    );
  }

  // 4) Fallback Coinzz quando coverage bloqueado
  if (state.stage === FLOW.COVERAGE_BLOCKED) {
    if (RX.YES.test(lower)) {
      state.stage = null;
      return REPLY(
        `Aqui está: ${P.link}
Checkout seguro pelo **${P.partner}**, valor **R$ ${P.prepaidPrice},00**, com **frete grátis** pelos Correios.`,
        "flow/offer#prepaid_link"
      );
    }
    if (RX.NO.test(lower)) {
      state.stage = null;
      return REPLY(`Sem problema 💚 Posso te mandar mais detalhes do produto ou retomamos quando preferir.`, "flow/offer#prepaid_declined");
    }
    return REPLY(
      `Quer receber o link oficial (**${P.partner}**) para finalizar por **R$ ${P.prepaidPrice},00** com **frete grátis** pelos Correios?`,
      "flow/offer#prepaid_offer_repeat"
    );
  }

  // 5) Coleta ordenada (coverage ok → já escolheu oferta)
  if (state.stage === FLOW.COLLECT_NAME || want("name", state)) {
    if (!ensureCheckout(state).name) {
      state.stage = FLOW.COLLECT_NAME;
      return REPLY(`Perfeito 💚 Me diga seu **nome completo**, por favor.`, "flow/offer#address_name");
    }
    state.stage = FLOW.COLLECT_PHONE;
  }

  if (state.stage === FLOW.COLLECT_PHONE || want("phone", state)) {
    const ck2 = ensureCheckout(state);
    if (!ck2.phone) {
      state.stage = FLOW.COLLECT_PHONE;
      return REPLY(`Obrigado, ${firstName(ck2.name)}! Agora o seu **telefone com DDD** (ex.: (61) 9XXXX-XXXX).`, "flow/offer#address_phone");
    }
    state.stage = FLOW.COLLECT_NUMBER;
  }

  if (state.stage === FLOW.COLLECT_NUMBER || want("number", state)) {
    const ck3 = ensureCheckout(state);
    if (!ck3.number) {
      state.stage = FLOW.COLLECT_NUMBER;
      return REPLY(`Anotado. Qual o **número** da residência?`, "flow/offer#address_number");
    }
    state.stage = FLOW.COLLECT_APTREF;
  }

  if (state.stage === FLOW.COLLECT_APTREF || want("aptref", state)) {
    const ck4 = ensureCheckout(state);
    if (!ck4.apt && !ck4.reference) {
      state.stage = FLOW.COLLECT_APTREF;
      return REPLY(`Tem **apartamento (bloco/apto)**? E algum **ponto de referência** que ajude o entregador? (Se não tiver, diga “não”).`, "flow/offer#address_aptref");
    }
    state.stage = FLOW.RECAP;
  }

  // Recap
  if (state.stage === FLOW.RECAP || want("recap", state)) {
    const ck5 = ensureCheckout(state);
    const rec = recapText(ck5);
    state.stage = FLOW.CONFIRMING;
    return REPLY(
      `Perfeito${ck5.name ? `, ${firstName(ck5.name)}` : ""}! Só pra garantir que anotei tudo certinho:\n${rec}\n\nEstá correto? Se quiser ajustar, me diga o que mudar (ex.: “trocar telefone” ou “sem referência”).`,
      "flow/offer#recap"
    );
  }

  // Confirmar → (opcional) API Logzz somente APÓS ratificação
  if (state.stage === FLOW.CONFIRMING) {
    const ck6 = ensureCheckout(state);

    if (RX.YES.test(lower)) {
      try { await remember(jid, { checkout: ck6 }); } catch {}
      let logzzOk = false;
      if (S?.integrations?.logzz?.webhook_url) {
        const payload = {
          customer: { name: ck6.name, phone: ck6.phone },
          address: { cep: ck6.cep, city: ck6.city, number: ck6.number, apt: ck6.apt, reference: ck6.reference },
          value: ck6.price || (ck6.units === 2 ? 197 : (P.promoDay || 150)),
          payment: "COD",
          notes: `Oferta escolhida: ${ck6.units===2 ? "2x197" : "1x150"}`,
          jid
        };
        const res = await postToLogzz(S, payload);
        logzzOk = !!res?.ok;
      }

      const prazoCap = P.capH;
      const prazoOut = P.othH;
      const parcelas = S?.payments?.installments_max || 12;

      state.stage = null;
      return REPLY(
        (logzzOk ? `Pedido registrado 🎉 ` : `Tudo certo com seus dados 💚 `) +
        `${ck6.name ? `${firstName(ck6.name)}, ` : ""}o entregador vai te chamar no WhatsApp para combinar o melhor horário.\n\n` +
        `• **Pagamento só na entrega (COD)**\n` +
        `• Aceitamos cartões e até ${parcelas}x (juros dependem da bandeira)\n` +
        `• Prazo: até ${prazoCap}h em capitais e até ${prazoOut}h nas demais\n\n` +
        `Qualquer dúvida, fico aqui com você 💚`,
        "flow/offer#confirmed_cod"
      );
    }

    if (RX.NO.test(lower)) {
      state.stage = FLOW.RECAP;
      return REPLY(`Claro! Me diga o que precisa ajustar (ex.: “corrigir telefone”, “nº da casa é 152”, “sem referência”).`, "flow/offer#recap_edit");
    }

    const rec2 = recapText(ck6);
    return REPLY(`Confere pra mim:\n${rec2}\n\nPosso registrar agora e pedir pro entregador te chamar no WhatsApp?`, "flow/offer#recap_repeat");
  }

  // 6) Fallback genérico
  state.stage = FLOW.ASK_CEP_CITY;
  return REPLY(
    `A Progressiva Vegetal serve para todos os tipos de cabelo e hidrata enquanto alinha.
Hoje: **R$ ${P.original},00** (cheio) e **R$ ${P.target},00** (Promo do Dia).
Quer que eu verifique seu **CEP** para liberar **promoção especial** com **pagamento só na entrega**?`,
    "flow/offer#fallback"
  );
}
