// configs/bots/claudia/flow/router.js
// Encaminha para flows corretos

import greet from "./greet.js";
import qualify from "./qualify.js";
import offer from "./offer.js";
import close from "./close.js";
import faq from "./faq.js";
import postsale from "./postsale.js";

export default {
  recepcao: greet,
  qualificacao: qualify,
  oferta: offer,
  fechamento: close,
  features: faq,
  posvenda: postsale,
};
