// src/core/nlu.js
// Classificador NLU leve por regras (regex/keywords), neutro e extensível.
// Objetivo: dar um "primeiro rótulo" consistente para o orquestrador/flows.

const RX = {
  greeting: /\b(oi|ol[áa]|boa\s*(tarde|noite|dia)|hey|e[ai]\b)/i,
  price: /\b(preç|valor|custa|quanto(?:\s+custa)?|por\s*quanto)\b/i,
  buy: /\b(compr(ar|a)|fechar|finalizar|quero|eu\s+quero|pode\s+fechar|manda(?:r)?\s+o?\s*link)\b/i,
  link: /\b(link|url)\b/i,
  installments: /\b(parcel|divid|em\s+\d{1,2}x|cart[aã]o)\b/i,
  company: /\b(empresa|com\s+quem|quem\s+são|qual\s+empresa)\b/i,
  hours: /\b(hor[áa]rio|atendem|funciona\s+at[eé]|que\s+horas)\b/i,
  sweepstakes: /\b(sorteio|brinde|pr[eê]mio|promo[cç][aã]o)\b/i,
  guarantee: /\b(garanti|devolu[cç][aã]o|reembolso|troca)\b/i,
  applications: /\b(aplica[cç][aã]o|aplica[cç][oõ]es|rende|quantas\s+vezes)\b/i,
  duration: /\b(dura|tempo|mes(es)?)\b/i,
  volume: /\b(\d+\s*ml|ml|mili|tamanho\s+do\s+frasco|frasco)\b/i,
  howToUse: /\b(como\s+usa(r)?|modo\s+de\s+uso|aplicar)\b/i,
  objections_price: /\b(caro|car[oa]|muito\s+alto|poderia\s+baixar)\b/i,
  audio: /\b(áudio|audio|mandar\s+voz|posso\s+enviar\s+áudio)\b/i,
  negativity: /\b(burra|idiota|merd|porra|droga|vac[aai]|ot[aá]ria?|incompetente)\b/i,
  thanks: /\b(obrigad[oa]|valeu|gratid[aã]o)\b/i,
  goodbye: /\b(tchau|até\s+mais|falou|encerrar)\b/i,
  address: /\b(rua|avenida|n[úu]mero|cep|bairro|cidade|estado|uf|refer[eê]ncia)\b/i,
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
  SMALL_TALK: "small_talk",
};

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
  ["GREETING", "greeting"],
];

export function classify(text = "") {
  const t = String(text || "").trim();
  if (!t) return { intent: INTENTS.SMALL_TALK, score: 0.1, entities: {} };

  for (const [label, rxKey] of ORDER) {
    const rx = RX[rxKey];
    if (rx?.test(t)) {
      return { intent: INTENTS[label], score: 0.9, entities: {} };
    }
  }

  // fallback
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
      return "oferta";
    case INTENTS.OBJECTION_PRICE: return "objeções"; // ou "objecoes"
    case INTENTS.AUDIO: return "oferta";
    case INTENTS.ADDRESS_DATA: return "fechamento";
    case INTENTS.THANKS:
    case INTENTS.GOODBYE: return "posvenda";
    case INTENTS.NEGATIVITY: return "oferta"; // responder neutro e redirecionar
    default: return "qualificacao";
  }
}

export default { classify, suggestNextStage, INTENTS };
