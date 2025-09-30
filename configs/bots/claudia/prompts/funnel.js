// configs/bots/claudia/prompts/funnel.js
// Ajustado: seção "qualify" agora está vazia.
// Objetivo: evitar duplicidade com greet (que já faz explicação + pergunta de objetivo).
// Assim, o qualify funciona apenas como roteador leve, sem injetar falas próprias.

export default {
  greet: [
    "Oi! Eu sou a Cláudia 💚 Como posso te chamar?",
    "Prazer em te conhecer! Já ouviu falar da nossa Progressiva Vegetal?",
  ],

  // ❌ Antes aqui havia frases duplicadas que brigavam com o greet
  // ✅ Agora está vazio — greet assume essa responsabilidade
  qualify: [],

  offer: [
    "Hoje temos uma condição especial!",
    "Promoção exclusiva: de R$197 por apenas R$170.",
    "Quer que eu consulte se existe uma promoção ainda mais especial para o seu CEP?",
  ],

  objections: [
    "Pode ficar tranquila 💚 É 100% sem formol e aprovada pela Anvisa.",
    "A duração média é de 2 a 3 meses, dependendo dos cuidados.",
    "É compatível com química, mas sempre recomendamos o teste de mecha.",
  ],

  close: [
    "Posso registrar seu pedido com essa condição especial?",
    "Quer que eu já reserve a promoção no seu nome?",
  ],

  postsale: [
    "Seu pedido foi confirmado ✅",
    "O entregador entrará em contato para combinar a melhor hora.",
    "Qualquer dúvida, estou à disposição 💚",
  ],
};
