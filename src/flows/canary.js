// src/flows/canary.js
export default async function canaryFlow({ userId, text }) {
  // aqui você pluga novas regras, prompts, preços, etc.
  if (!text) return 'Oi! 🌟 (canário) Me conta rapidinho sobre seu cabelo?';
  return `🔬 (canário) Entendi: "${text}". Me fala também se é liso, ondulado, cacheado ou crespo?`;
}
