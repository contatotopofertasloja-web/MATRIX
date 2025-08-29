// src/utils/polish.js
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;

export function limitSentencesEmojis(text, maxSentences = 2, maxEmojis = 2) {
  if (!text) return text;

  // limita sentenças
  const parts = String(text).split(/\s*(?:\.|\?|!)\s*/).filter(Boolean);
  let trimmed = parts.slice(0, maxSentences).join('. ');
  if (!/[.!?]$/.test(trimmed)) trimmed += '.';

  // limita emojis
  const emojis = [...trimmed.matchAll(EMOJI_REGEX)].map(m => m[0]);
  if (emojis.length > maxEmojis) {
    let over = emojis.length - maxEmojis;
    trimmed = trimmed.replace(EMOJI_REGEX, m => (over-- > 0 ? '' : m));
  }
  return trimmed.replace(/\s{2,}/g, ' ').trim();
}
