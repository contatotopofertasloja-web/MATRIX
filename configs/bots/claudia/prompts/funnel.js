// configs/bots/claudia/prompts/funnel.js
// O orquestrador SÓ pode falar usando estas frases.
// Você pode A/B testar adicionando/removendo variações por etapa.
// Agora com pickFunnelLine(stage, settings) para substituir placeholders + carimbar.

function render(tpl = "", settings = {}) {
  const p = settings?.product || {};
  return String(tpl || "")
    .replace(/\{\{price_target\}\}/g, p.price_target ?? "")
    .replace(/\{\{checkout_link\}\}/g, p.checkout_link ?? "")
    .trim();
}

function suffix(stage) {
  return ` (prompts/funnel#${stage})`;
}

function pick(stage, settings = {}) {
  const list = funnel[stage] || [];
  if (!list.length) return "";
  const idx = Math.floor(Math.random() * list.length);
  const raw = list[idx];
  const out = render(raw, settings) + suffix(stage);
  console.log(`[funnel] stage=${stage} variant=${idx} textPreview=${out.slice(0,60)}`);
  return out;
}

export const funnel = {
  // 1) GREET — foto de abertura sai automática; aqui, 1 linha objetiva:
  greet: [
    "Oi, amor 💖 Eu sou a Cláudia! Seu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?",
    "Cheguei por aqui ✨ Pra eu te indicar certinho: teu cabelo é **liso**, **ondulado**, **cacheado** ou **crespo**?",
  ],

  // 2) QUALIFY — apenas perguntas-chave; orquestrador aplica cooldown pra não repetir em loop
  qualify: [
    "Você já fez progressiva antes?",
    "Prefere o resultado **bem liso** ou **alinhado** com menos frizz?",
    "Show! Só mais uma coisinha: quer controlar **frizz** e **volume**, certo?",
  ],

  // 3) OFFER — CTA forte; preço controla por settings/guardrails; {{price_target}} é substituído e só sai quando pedirem preço
  offer: [
    "Tá numa condição top: de 197 por **{{price_target}}** com **paga quando recebe (COD)**. Quer o **link** pra garantir agora?",
    "Fechamos no melhor: **{{price_target}}** à vista no site (PIX/cartão) ou **COD** na entrega. Te mando o **link** seguro?",
  ],

  // 4) CLOSE — sempre encaminha pro checkout, mas também abre caminho pra coletar CEP/telefone se a cliente preferir
  close: [
    "Aqui está o **checkout seguro**: {{checkout_link}} — se preferir, me passa **telefone com DDD** e **CEP** que eu finalizo por aqui 💛",
    "Pode finalizar por aqui: {{checkout_link}} ✨ Se achar melhor, manda **telefone + CEP** que eu fecho tudo por você.",
    "Link seguro: {{checkout_link}}. Quer que eu gere o pedido **COD**? Me passa **telefone** e **CEP** rapidinho.",
  ],

  // 5) POSTSALE — confirmação e reforço de uso/acompanhar pedido
  postsale: [
    "Pedido confirmado! ✨ Vou te enviar as atualizações por aqui. Qualquer dúvida, me chama.",
    "Tudo certinho por aqui ✅ Assim que o pedido sair, te aviso. E te mando também o passo a passo de uso.",
  ],
};

export function pickFunnelLine(stage, settings) {
  return pick(stage, settings);
}

export default funnel;
