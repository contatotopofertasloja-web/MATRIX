// src/core/nlu.js
// Classificador NLU leve por regras (regex/keywords), neutro e extensível.
// - Mantém regex internas (estáveis).
// - Opcionalmente carrega gatilhos do configs/bots/<bot_id>/prompts/faq.yaml para INTENT FAQ.
// - Logs de debug controlados por env (NLU_DEBUG=1).

import fs from "node:fs";
import path from "node:path";
import { BOT_ID } from "./settings.js";

const DEBUG = ["1","true","yes","y","on"].includes(String(process.env.NLU_DEBUG||"").toLowerCase());

// ========================= Regex base (estáveis) =========================
const RX = {
  greeting: /\b(oi|ol[áa]|boa\s*(tarde|noite|dia)|hey|e[ai]\b)/i,
  price: /\b(preç|valor|custa|quanto(?:\s+custa)?|por\s*quanto)\b/i,
  buy: /\b(compr(ar|a)|fechar|finalizar|quero|eu\s+quero|pode\s+fechar|manda(?:r)?\s+o?\s*link)\b/i,
  link: /\b(link|url)\b/i,
  installments: /\b(parcel|divid|em\s+\d{1,2}x|cart[aã]o)/i,
  company: /\b(empresa|com\s+quem|quem\s+são|qual\s+empresa)/i,
  hours: /\b(hor[áa]rio|atendem|funciona\s+at[eé]|que\s+horas)/i,
  sweepstakes: /\b(sorteio|brinde|pr[eê]mio|promo[cç][aã]o)/i,
  guarantee: /\b(garanti|devolu[cç][aã]o|reembolso|troca)/i,
  applications: /\b(aplica[cç][aã]o|aplica[cç][oõ]es|rende|quantas\s+vezes)/i,
  duration: /\b(dura|tempo|mes(es)?)\b/i,
  volume: /\b(\d+\s*ml|ml|mili|tamanho\s+do\s+frasco|frasco)/i,
  howToUse: /\b(como\s+usa(r)?|modo\s+de\s+uso|aplicar)\b/i,
  objections_price: /\b(caro|car[oa]|muito\s+alto|poderia\s+baixar)\b/i,
  audio: /\b(áudio|audio|mandar\s+voz|posso\s+enviar\s+áudio)/i,
  negativity: /\b(burra|idiota|merd|porra|droga|vac[aai]|ot[aá]ria?|incompetente)\b/i,
  thanks: /\b(obrigad[oa]|valeu|gratid[aã]o)\b/i,
  goodbye: /\b(tchau|até\s+mais|falou|encerrar)\b/i,
  address: /\b(rua|avenida|n[úu]mero|cep|bairro|cidade|estado|uf|refer[eê]ncia)\b/i,
  // FAQ (dinâmico via YAML) ficará em RX.__faq_dyn (array de regex)
};

const INTENTS = {
  GREETING: "greeting",
  ASK_PRICE: "ask_price",
  BUY: "buy",
  ASK_LINK: "ask_link",
  INSTALLMENTS: "installments",
  COMPANY: "company",
  HOURS: "hours",
  SWEEPSTAKES: "sweepstakes",
  GUARANTEE: "guarantee",
  APPLICATIONS: "applications",
  DURATION: "duration",
  VOLUME: "volume",
  HOW_TO_USE: "how_to_use",
  OBJECTION_PRICE: "objection_price",
  AUDIO: "audio",
  NEGATIVITY: "negativity",
  THANKS: "thanks",
  GOODBYE: "goodbye",
  ADDRESS_DATA: "address_data",
  FAQ: "faq",            // <— novo intent para o faq.yaml
  SMALL_TALK: "small_talk",
};

// Ordem de verificação (prioridades)
const ORDER = [
  ["NEGATIVITY", "negativity"],
  ["BUY", "buy"],
  ["ASK_PRICE", "price"],
  ["ASK_LINK", "link"],
  ["INSTALLMENTS", "installments"],
  ["COMPANY", "company"],
  ["HOURS", "hours"],
  ["SWEEPSTAKES", "sweepstakes"],
  ["GUARANTEE", "guarantee"],
  ["APPLICATIONS", "applications"],
  ["DURATION", "duration"],
  ["VOLUME", "volume"],
  ["HOW_TO_USE", "howToUse"],
  ["AUDIO", "audio"],
  ["ADDRESS_DATA", "address"],
  ["THANKS", "thanks"],
  ["GOODBYE", "goodbye"],
  // FAQ dinâmico entra aqui, antes de GREETING/SMALL_TALK (se houver YAML)
  ["FAQ", "__faq_dyn"],
  ["GREETING", "greeting"],
];

// ========================= Loader opcional do faq.yaml =========================
let _faqLoaded = false;

function findFaqYamlPath(botId) {
  // suporta duas localizações usuais
  const candidates = [
    path.join(process.cwd(), "configs", "bots", botId, "prompts", "faq.yaml"),
    path.join(process.cwd(), "configs", "bots", botId, "faq.yaml"),
  ];
  for (const f of candidates) {
    try { if (fs.existsSync(f) && fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}

function toRegexSafe(s) {
  // cria regex tolerante a acentos e variações simples
  // substitui espaços por \s+, escapa pontuação básica
  const esc = String(s || "")
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(esc, "i");
}

async function loadFaqTriggersIfAny() {
  if (_faqLoaded) return;
  const botId = BOT_ID || "default";
  const file = findFaqYamlPath(botId);
  if (!file) { _faqLoaded = true; return; }

  let YAML = null;
  try {
    // dependência opcional
    YAML = (await import("yaml")).default;
  } catch { /* sem yaml, seguimos sem FAQ dinâmico */ }

  if (!YAML) { _faqLoaded = true; return; }

  try {
    const raw = fs.readFileSync(file, "utf8");
    const doc = YAML.parse(raw);
    const cats = doc && doc.categories;
    const rxList = [];

    if (cats && typeof cats === "object") {
      for (const cat of Object.values(cats)) {
        const triggers = Array.isArray(cat?.triggers) ? cat.triggers : [];
        for (const t of triggers) {
          try { rxList.push(toRegexSafe(t)); } catch {}
        }
      }
    }
    if (rxList.length) {
      RX.__faq_dyn = rxList; // guarda como lista de regex
      if (DEBUG) console.log(`[NLU] FAQ YAML carregado (${rxList.length} gatilhos) de ${file}`);
    }
  } catch (e) {
    if (DEBUG) console.warn("[NLU] Falha ao ler faq.yaml:", e?.message || e);
  } finally {
    _faqLoaded = true;
  }
}

// ========================= API pública =========================
export async function classify(text = "") {
  const t = String(text || "").trim();
  if (!t) return { intent: INTENTS.SMALL_TALK, score: 0.1, entities: {} };

  // tenta carregar os triggers do YAML na primeira chamada
  if (!_faqLoaded) { await loadFaqTriggersIfAny(); }

  for (const [label, rxKey] of ORDER) {
    if (rxKey === "__faq_dyn") {
      const arr = RX.__faq_dyn || [];
      if (arr.length) {
        for (const rx of arr) {
          if (rx.test(t)) {
            if (DEBUG) console.log(`[NLU] hit YAML -> intent=FAQ phrase="${t.slice(0,60)}"`);
            return { intent: INTENTS.FAQ, score: 0.85, entities: {} };
          }
        }
      }
      continue;
    }

    const rx = RX[rxKey];
    if (rx?.test(t)) {
      const intentKey = INTENTS[label];
      if (DEBUG) console.log(`[NLU] hit RX -> intent=${intentKey} key=${rxKey} phrase="${t.slice(0,60)}"`);
      return { intent: intentKey, score: 0.9, entities: {} };
    }
  }

  // fallback
  if (DEBUG) console.log(`[NLU] fallback -> SMALL_TALK phrase="${t.slice(0,60)}"`);
  return { intent: INTENTS.SMALL_TALK, score: 0.3, entities: {} };
}

/**
 * Sugestões de transição por intent (opcional).
 * O orquestrador pode usar isso como hint.
 */
export function suggestNextStage(intent) {
  switch (intent) {
    case INTENTS.GREETING: return "recepcao";
    case INTENTS.ASK_PRICE: return "oferta";
    case INTENTS.BUY:
    case INTENTS.ASK_LINK: return "fechamento";
    case INTENTS.INSTALLMENTS:
    case INTENTS.COMPANY:
    case INTENTS.HOURS:
    case INTENTS.SWEEPSTAKES:
    case INTENTS.GUARANTEE:
    case INTENTS.APPLICATIONS:
    case INTENTS.DURATION:
    case INTENTS.VOLUME:
    case INTENTS.HOW_TO_USE:
    case INTENTS.FAQ: // <— FAQ leva pra oferta/explicação curta
      return "oferta";
    case INTENTS.OBJECTION_PRICE: return "objecoes";
    case INTENTS.AUDIO: return "oferta";
    case INTENTS.ADDRESS_DATA: return "fechamento";
    case INTENTS.THANKS:
    case INTENTS.GOODBYE: return "posvenda";
    case INTENTS.NEGATIVITY: return "oferta"; // responder neutro e redirecionar
    default: return "qualificacao";
  }
}

export default { classify, suggestNextStage, INTENTS };
