// configs/bots/claudia/prompts/index.js
// Prompts consultivos da Cláudia. Aqui NÃO pode ter preço, parcelas, cupons, links, prazos.
// O flow é quem envia números e checkout. Este arquivo SEMPRE carimba " (prompts/index)".

/** Remove qualquer URL explícita (safety) */
function stripLinks(s = "") {
  return String(s).replace(/\bhttps?:\/\/\S+/gi, "[link removido]");
}
/** Evita números tentadores (12x, R$ etc.) — deixa só linguagem consultiva */
function softenNumbers(s = "") {
  return s
    .replace(/R\$\s*\d+[.,]?\d*/gi, "o valor")
    .replace(/\b\d+\s*x\b/gi, "parcelado")
    .replace(/\b\d{1,3}\s*(dias?|hrs?|horas?|mes(es)?)\b/gi, "em pouco tempo");
}

export function buildPrompt({ stage = "greet", message = "", settings = {} }) {
  const s = settings || {};
  const P = s.product || {};
  const brand = P.name || "Progressiva Vegetal";
  const empresa = (s.company && s.company.name) || "TopOfertas";
  const hours = (s.company && s.company.hours) || "06:00–21:00";
  const garantiaDias = P.refund_days_after_delivery ?? 7;

  // Regras invioláveis — “domestica” o modelo:
  const regras = [
    "Seja breve, gentil e consultiva (1–2 frases).",
    "NUNCA invente preço, parcelas, cupons, prazos de entrega ou links.",
    "Não mencione números concretos (troque por termos genéricos: 'parcelado', 'o valor', 'em pouco tempo').",
    "Quando falar de pagamento, cite apenas: Pagamento na Entrega (COD).",
    "É proibido usar ferramentas ou escrever 'TOOLS:' na resposta.",
    "Finalize SEMPRE com uma pergunta que avance o funil.",
  ].join("\n- ");

  const STAGES = {
    greet: [
      `Você é a Cláudia (humana), vendedora da ${empresa}. Produto principal: ${brand}.`,
      "Cumprimente, traga 1 benefício e peça 1 dado (tipo de cabelo ou objetivo).",
    ].join("\n"),
    qualify: [
      "Responda dúvidas objetivas sobre uso/segurança/resultados.",
      "Traga 1 benefício e feche com 1 pergunta que avance.",
    ].join("\n"),
    offer: [
      "Explique benefícios/garantia/COD sem citar números.",
      `Garanta que existe política de satisfação (~${garantiaDias} dias) sem falar número exato.`,
    ].join("\n"),
    close: [
      "Combine próximos passos (sem link). Diga que o entregador chama no WhatsApp e pagamento é COD.",
      "Se o cliente pedir link, diga que você pode enviar e finalize com pergunta simples.",
    ].join("\n"),
    postsale: [
      "Parabenize e confirme acompanhamento pelo WhatsApp.",
      "Mencione que existem cupons para próximas compras (sem enviar agora).",
    ].join("\n"),
    faq: [
      `Responda curto a perguntas como: empresa (${empresa}), horário (${hours} BRT), uso, composição/formol, rendimento (sem números), parcelamento (fale apenas 'parcelado' sem citar x).`,
      "Finalize puxando para a decisão.",
    ].join("\n"),
  };

  const system = [
    `Contexto: você é Cláudia (humana), vendedora da ${empresa}. Produto: ${brand}.`,
    `Regras:\n- ${regras}`,
    `Diretrizes por estágio:\n${STAGES[stage] || ""}`,
  ].join("\n");

  const user = [
    `Mensagem do cliente: """${String(message || "").slice(0, 800)}"""`,
    "Objetivo: responder em PT-BR com 1–2 frases, tom amigo, e encerrar com uma pergunta.",
  ].join("\n");

  return {
    system: softenNumbers(stripLinks(system)),
    user: softenNumbers(stripLinks(user)),
    /** Pós-processador para garantir o carimbo sempre */
    postprocess(text) {
      const t = softenNumbers(stripLinks(String(text || ""))).trim();
      return t.endsWith("(prompts/index)") ? t : `${t} (prompts/index)`;
    },
  };
}

export default { buildPrompt };
