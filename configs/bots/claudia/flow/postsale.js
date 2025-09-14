// configs/bots/claudia/flow/postsale.js
import { callUser, getFixed } from "./_state.js";

export default async function postsale(ctx) {
  const { state, settings } = ctx;
  const fx = getFixed(settings);

  const thanks =
    `Obrigada pela confiança, ${callUser(state)}! ✨ Qualquer dúvida na aplicação, me chama.\n` +
    (fx.sorteioOn ? `Ah, e você já está concorrendo ao nosso **sorteio do mês** 🎁. Boa sorte!` : "");

  return { reply: thanks, next: "posvenda" };
}
