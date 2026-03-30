export const config = {
  // Quantidade máxima de resultados que o script tentará extrair POR PESQUISA.
  // Colocamos 150 para garantir exaustão da tela do Maps por cada bairro.
  maxResultsPerSearch: 150,

  // Lista de localidades para mesclar com as categorias
  locations: [
    "Pinheiros, São Paulo, SP",
    "Vila Mariana, São Paulo, SP",
    "Jardins, São Paulo, SP",
    "Itaim Bibi, São Paulo, SP",
    "Morumbi, São Paulo, SP",
    "Tatuapé, São Paulo, SP",
    "Santana, São Paulo, SP",
    "Perdizes, São Paulo, SP",
    "Lapa, São Paulo, SP",
    "Santo Amaro, São Paulo, SP"
  ],

  // Categorias baseadas na sua lista (já sem as repetidas)
  categories: [
    "Salões de beleza",
    "Clínica de estéticas",
    "Manicure",
    "Serviço de depilação a cera",
    "Cabeleireiro",
    "Depilação",
    "Salão de massagem para os pés",
    "Spa facial",
    "Salão de sobrancelhas",
    "Centro de saúde e beleza",
    "Clínica especializada",
    "Clínica de Fisioterapia",
    "Esteticista",
    "Studio de cílios",
    "Massoterapeuta"
  ]
};
