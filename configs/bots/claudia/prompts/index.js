// configs/bots/claudia/prompts/index.js
// Prompt neutro fallback (só se flow_only=false). Evita perguntar tipo de cabelo.

export function buildPrompt({ stage, intent, message }) {
  const system = "Você é Cláudia, consultora de vendas da Progressiva Vegetal. Nunca diga que é IA.";
  const user = `Mensagem do cliente: "${message}". Responda de forma breve e educada.`;
  return { system, user };
}

export default { buildPrompt };
