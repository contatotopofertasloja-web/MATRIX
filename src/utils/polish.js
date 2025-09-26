// src/utils/polish.js
// Utilitários neutros de polimento de resposta
// - Nunca quebra com texto vazio
// - Remove termos proibidos (ex.: "assistente virtual")
// - Encurta respostas muito longas
// - Suaviza tom e evita ironia
// - Normaliza espaços e quebras de linha

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

const MAX_CHARS = Number(process.env.POLISH_MAX_CHARS || '450'); // 1 bolha curta

function stripForbidden(s) {
  let out = String(s || '');
  for (const rx of FORBIDDEN_PATTERNS) out = out.replace(rx, '');
  // Remove espaços duplos deixados por remoções
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out;
}

function softenTone(s) {
  let out = String(s || '');
  for (const rx of RUDE_TONES) out = out.replace(rx, '');
  // pequenas suavizações
  out = out
    .replace(/\b(nao|não)\b\s*(tem|sei)/gi, 'posso te explicar rapidinho')
    .replace(/\b(pera|calma)\b/gi, 'claro');
  return out;
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

export function polishReply(text, { stage, settings } = {}) {
  // Nunca quebra
  let out = String(text || '').trim();

  // Se veio vazio do LLM/flow, cria fallback simpático por estágio
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

  // Guardrails simples (respeita settings, mas sem cheiros de bot)
  out = stripForbidden(out);
  out = softenTone(out);
  out = normalizeWhitespace(out);
  out = truncate(out);

  // Opcional: reforço do CTA por estágio (sem forçar a cada mensagem)
  if (/^oferta$|^fechamento$/.test(String(stage || '')) && !/\blink\b|\bcheckout\b|\bpedido\b/i.test(out)) {
    out += '\n\nSe preferir, já te mando o link do pedido. 👍';
  }

  return out;
}

// Ajuda a consolidar múltiplas linhas em bolhas seguras
export function consolidateBubbles(lines = []) {
  const arr = Array.isArray(lines) ? lines : [String(lines || '')];
  const safe = arr
    .map((l) => truncate(normalizeWhitespace(stripForbidden(l || ''))))
    .filter((l) => l && l.trim());
  // Política do core: 1–2 bolhas no máximo aqui; mais que isso, faça no flow.
  return safe.slice(0, 2);
}

export default { polishReply, consolidateBubbles };
