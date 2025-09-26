// src/utils/polish.js
// Utilitários neutros de polimento/sanitização
// - sanitizeOutbound: limpa texto antes de enviar (links/preço/whitespace/limite)
// - polishReply: embeleza respostas geradas (fallback por estágio, tom, etc.)
// - consolidateBubbles: garante 1–2 bolhas curtas

// ==== Configs simples ====
const MAX_CHARS = Number(process.env.POLISH_MAX_CHARS || '450'); // limite de uma bolha curta

// Palavras/expressões proibidas (nunca mencionar IA/assistente)
const FORBIDDEN_PATTERNS = [
  /\bassistente(?:\s+virtual)?\b/gi,
  /\bIA\b/gi,
  /\bintelig[eê]ncia artificial\b/gi,
];

// Tons ríspidos/irônicos comuns
const RUDE_TONES = [
  /calma[,!.\s]/i,
  /você não entendeu/i,
  /isso (é )?óbvio/i,
  /como (assim|vc) não sabe/i,
  /isso virou/i,
];

// ==== Helpers básicos ====
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

// ==== Sanitização de saída (para qualquer canal) ====
// options:
//  - allowLink: mantém URLs; senão, oculta como [link removido]
//  - allowPrice: mantém valores monetários; senão, normaliza (ex.: "R$ 170" -> "R$ ***")
export function sanitizeOutbound(text, { allowLink = false, allowPrice = false } = {}) {
  let out = stripCodeFences(String(text || ''));

  // Remove/mascara links se não permitido
  if (!allowLink) {
    out = out.replace(/https?:\/\/\S+/gi, '[link removido]');
  }

  // Mascara preços se não permitido (R$ 170, 170,00; 170.00; etc.)
  if (!allowPrice) {
    out = out
      // R$ 170,00 | R$170 | R$ 1.234,56
      .replace(/\bR\$\s?\d{1,3}(\.\d{3})*(,\d{2})?\b/g, 'R$ ***')
      // 170,00 | 1.234,56 (quando claramente seguido de "reais", "R$", "por", etc.)
      .replace(/\b(\d{1,3}(\.\d{3})*(,\d{2})?)\s*(reais|rs|r\$|por)?\b/gi, (m, num, _g, _c, tail) => {
        return tail ? '***' : m; // só troca quando há alta chance de ser preço
      });
  }

  // Nunca menciona IA/assistente; remove tons ruins; normaliza espaço; corta
  out = stripForbidden(out);
  out = softenTone(out);
  out = normalizeWhitespace(out);
  out = truncate(out);

  return out;
}

// ==== Polimento de respostas geradas (LLM/flows) ====
export function polishReply(text, { stage, settings } = {}) {
  let out = String(text || '').trim();

  // Fallbacks por estágio (se vier vazio)
  if (!out) {
    switch (String(stage || '')) {
      case 'recepcao':
        out = 'Consegue me dizer como é seu cabelo? (liso, ondulado, cacheado ou crespo) 💇‍♀️';
        break;
      case 'qualificacao':
        out = 'Legal! Já fez progressiva antes ou quer reduzir mais o frizz/volume?';
        break;
      case 'oferta':
        out = 'Posso te passar a condição de hoje e o link seguro do pedido. Quer?';
        break;
      case 'objecoes':
        out = 'Te entendo! Posso te mandar resultados reais e explicar o modo de uso?';
        break;
      case 'fechamento':
        out = 'Te envio o link de checkout para garantir o valor agora?';
        break;
      default:
        out = 'Me conta rapidinho como é seu cabelo (liso, ondulado, cacheado ou crespo)?';
    }
  }

  // Guardrails e acabamento
  out = stripForbidden(out);
  out = softenTone(out);
  out = normalizeWhitespace(out);
  out = truncate(out);

  // CTA gentil em oferta/fechamento (sem forçar todo o tempo)
  if (/^oferta$|^fechamento$/.test(String(stage || '')) && !/\blink\b|\bcheckout\b|\bpedido\b/i.test(out)) {
    out += '\n\nSe preferir, já te mando o link do pedido. 👍';
  }

  return out;
}

// Consolida múltiplas strings em até 2 bolhas seguras
export function consolidateBubbles(lines = []) {
  const arr = Array.isArray(lines) ? lines : [String(lines || '')];
  const safe = arr
    .map((l) => truncate(normalizeWhitespace(stripForbidden(l || ''))))
    .filter((l) => l && l.trim());
  return safe.slice(0, 2);
}

export default { sanitizeOutbound, polishReply, consolidateBubbles };
