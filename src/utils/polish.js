// src/utils/polish.js — sanitização neutra + CTAs genéricos
const MAX_CHARS = Number(process.env.POLISH_MAX_CHARS || '450');

const FORBIDDEN_PATTERNS = [
  /\bassistente(?:\s+virtual)?\b/gi,
  /\bIA\b/gi,
  /\bintelig[eê]ncia artificial\b/gi,
];

const RUDE_TONES = [
  /calma[,!.\s]/i,
  /você não entendeu/i,
  /isso (é )?óbvio/i,
  /como (assim|vc) não sabe/i,
  /isso virou/i,
];

function stripForbidden(s) {
  let out = String(s || '');
  for (const rx of FORBIDDEN_PATTERNS) out = out.replace(rx, '');
  return out.replace(/\s{2,}/g, ' ').trim();
}
function softenTone(s) {
  let out = String(s || '');
  for (const rx of RUDE_TONES) out = out.replace(rx, '');
  return out.replace(/\b(nao|não)\b\s*(tem|sei)/gi, 'posso verificar pra você rapidamente');
}
function normalizeWhitespace(s) {
  return String(s || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
function truncate(s, max = MAX_CHARS) {
  const str = String(s || '');
  return str.length <= max ? str : str.slice(0, max - 1).trimEnd() + '…';
}
function stripCodeFences(s = '') {
  const t = String(s).trim();
  if (!t.startsWith('```')) return t;
  return t.replace(/^```[a-z0-9]*\s*/i, '').replace(/```$/, '').trim();
}

// --- injeção de preços para as bolhas da oferta ---
function injectOfferPrices(out) {
  const O = process.env.CLAUDIA_PRICE_ORIGINAL   ?? '197';
  const T = process.env.CLAUDIA_PRICE_TARGET     ?? '170';
  const P = process.env.CLAUDIA_PRICE_PROMO_DAY  ?? T;

  // substitui apenas placeholders "R$ ****"
  out = out.replace(/(Preço\s*cheio:\s*)R\$\s?\*{3,4}/i, `$1R$ ${O}`);
  out = out.replace(/(Promo\s*do\s*dia:\s*)R\$\s?\*{3,4}/i, `$1R$ ${T}`);
  // fallback para casos de "Promo relâmpago" / "Promoção especial"
  out = out.replace(/(Promo(?:ção)?\s*(?:relâmpago|especial)?:\s*)R\$\s?\*{3,4}/i, `$1R$ ${P}`);
  return out;
}

export function sanitizeOutbound(text, { allowLink = false, allowPrice = false, tag = null } = {}) {
  let out = stripCodeFences(String(text || ''));

  // se for bolha de OFFER, liberamos preço e injetamos ENV antes
  const isOffer = /^flow\/offer#/i.test(String(tag || ''));
  if (isOffer) {
    allowPrice = true;
    out = injectOfferPrices(out);
  }

  if (!allowLink) out = out.replace(/https?:\/\/\S+/gi, '[link removido]');
  if (!allowPrice) {
    out = out
      .replace(/\bR\$\s?\d{1,3}(\.\d{3})*(,\d{2})?\b/g, 'R$ ***')
      .replace(/\b(\d{1,3}(\.\d{3})*(,\d{2})?)\s*(reais|rs|r\$|por)?\b/gi,
        (m, num, _g, _c, tail) => (tail ? '***' : m));
  }

  out = stripForbidden(out);
  out = softenTone(out);
  out = normalizeWhitespace(out);
  out = truncate(out);
  return out;
}

export function polishReply(text, { stage } = {}) {
  let out = String(text || '').trim();

  // ⚠️ Ajuste: neutralizar fallback de recepção (greet já trata essa etapa)
  if (!out) {
    switch (String(stage || '')) {
      case 'recepcao':
        out = '';
        break;
      case 'qualificacao':
        out = 'Legal! Me diga rapidamente seu objetivo e eu adianto as condições pra você.';
        break;
      case 'oferta':
        out = 'Posso te passar as condições de hoje e verificar pagamento na entrega. Quer?';
        break;
      case 'fechamento':
        out = 'Te envio o link seguro para finalizar agora?';
        break;
      default:
        out = 'Certo! Me conta rapidinho o que você precisa e eu já te ajudo.';
    }
  }

  out = stripForbidden(out);
  out = softenTone(out);
  out = normalizeWhitespace(out);
  out = truncate(out);

  if (/^oferta$|^fechamento$/.test(String(stage || '')) && !/\blink\b|\bcheckout\b|\bpedido\b/i.test(out)) {
    out += '\n\nSe preferir, já te envio o link do pedido.';
  }
  return out;
}

export function consolidateBubbles(lines = []) {
  const arr = Array.isArray(lines) ? lines : [String(lines || '')];
  const safe = arr
    .map((l) => truncate(normalizeWhitespace(stripForbidden(l || ''))))
    .filter((l) => l && l.trim());
  return safe.slice(0, 2);
}

export default { sanitizeOutbound, polishReply, consolidateBubbles };
