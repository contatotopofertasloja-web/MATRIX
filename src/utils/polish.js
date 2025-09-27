// src/utils/polish.js
// Sanitiza e suaviza a saída; remove "assistente/IA", consolida em 1–2 bolhas,
// e adiciona CTAs gentis nos estágios chave.

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
  return out
    .replace(/\b(nao|não)\b\s*(tem|sei)/gi, 'posso te explicar rapidinho')
    .replace(/\b(pera|calma)\b/gi, 'claro');
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
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + '…';
}
function stripCodeFences(s = '') {
  const t = String(s).trim();
  if (!t.startsWith('```')) return t;
  return t.replace(/^```[a-z0-9]*\s*/i, '').replace(/```$/,'').trim();
}

export function sanitizeOutbound(text, { allowLink = false, allowPrice = false } = {}) {
  let out = stripCodeFences(String(text || ''));

  if (!allowLink) out = out.replace(/https?:\/\/\S+/gi, '[link removido]');

  if (!allowPrice) {
    out = out
      .replace(/\bR\$\s?\d{1,3}(\.\d{3})*(,\d{2})?\b/g, 'R$ ***')
      .replace(/\b(\d{1,3}(\.\d{3})*(,\d{2})?)\s*(reais|rs|r\$|por)?\b/gi, (m, num, _g, _c, tail) => tail ? '***' : m);
  }

  out = stripForbidden(out);
  out = softenTone(out);
  out = normalizeWhitespace(out);
  out = truncate(out);

  return out;
}

export function polishReply(text, { stage } = {}) {
  let out = String(text || '').trim();

  if (!out) {
    switch (String(stage || '')) {
      case 'recepcao':     out = 'Consegue me dizer como é seu cabelo? (liso, ondulado, cacheado ou crespo)'; break;
      case 'qualificacao': out = 'Legal! Já fez progressiva antes ou quer reduzir mais o frizz/volume?'; break;
      case 'oferta':       out = 'Posso te passar a condição de hoje e verificar o pagamento na entrega no seu CEP. Quer?'; break;
      case 'fechamento':   out = 'Te envio o link seguro para garantir o valor agora?'; break;
      default:             out = 'Me conta rapidinho como é seu cabelo (liso, ondulado, cacheado ou crespo)?';
    }
  }

  out = stripForbidden(out);
  out = softenTone(out);
  out = normalizeWhitespace(out);
  out = truncate(out);

  if (/^oferta$|^fechamento$/.test(String(stage || '')) && !/\blink\b|\bcheckout\b|\bpedido\b/i.test(out)) {
    out += '\n\nSe preferir, já te mando o link do pedido.';
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
