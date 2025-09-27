// scripts/check-flows-static.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FLOW_DIR = path.resolve(__dirname, "../configs/bots/claudia/flow");

const FILES = {
  greet: path.join(FLOW_DIR, "greet.js"),
  qualify: path.join(FLOW_DIR, "qualify.js"),
  offer: path.join(FLOW_DIR, "offer.js"),
  close: path.join(FLOW_DIR, "close.js"),
  postsale: path.join(FLOW_DIR, "postsale.js"),
};

function fail(msg) {
  console.error("✖", msg);
  process.exitCode = 1; // não derruba imediatamente no Railway
}
function ok(msg) {
  console.log("✔", msg);
}
function ensure(cond, msg) {
  if (!cond) fail(msg);
  else ok(msg);
}
function read(p) {
  if (!fs.existsSync(p)) fail(`Arquivo não encontrado: ${p}`);
  return fs.readFileSync(p, "utf8");
}

(function main() {
  console.log("== Static Flow Checks ==");

  // greet.js
  const greet = read(FILES.greet);
  ensure(/opening_photo_url|product\.image_url/.test(greet), "greet: envia imagem de abertura");
  ensure(/N[aÃ]O envia link|Nunca envia link/i.test(greet) || /type:\s*'image'/.test(greet), "greet: sem link");

  // qualify.js
  const qualify = read(FILES.qualify);
  ensure(/stage:\s*'qualificacao'/.test(qualify), "qualify: usa stage 'qualificacao'");
  ensure(/sem preço|sem links|sem cupom/i.test(qualify), "qualify: regra anti-preço/link");

  // offer.js
  const offer = read(FILES.offer);
  ensure(/sanitizeLinks/.test(offer), "offer: possui sanitizeLinks");
  ensure(/clampPrice/.test(offer), "offer: possui clampPrice");
  ensure(/stage:\s*'oferta'/.test(offer), "offer: usa stage 'oferta'");
  ensure(/N[ÃA]O mencione cupom|N[ÃA]O fale de cupom/i.test(offer), "offer: anti-cupom presente");

  // close.js
  const close = read(FILES.close);
  ensure(/onlyAllowedLink/.test(close), "close: possui onlyAllowedLink");
  ensure(/stage:\s*'fechamento'/.test(close), "close: usa stage 'fechamento'");
  ensure(/COD|Pagamento na entrega/.test(close), "close: reforça COD");

  // postsale.js
  const postsale = read(FILES.postsale);
  ensure(/stage:\s*'posvenda'/.test(postsale), "postsale: usa stage 'posvenda'");
  ensure(/Sem cupom|sem cupom/i.test(postsale), "postsale: sem cupom");
  ensure(/replace\(.+https\?:\/\/\\S\+\/gi/.test(postsale) || /sem links/i.test(postsale), "postsale: remove links");

  console.log("\n✅ Static checks OK.");
})();
