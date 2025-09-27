// tools/scaffold-bot.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');

function p(...x){ return path.join(ROOT, ...x); }
function ensureDir(d){ if(!fs.existsSync(d)) fs.mkdirSync(d, { recursive:true }); }
function writeIfMissing(file, content){
  if(!fs.existsSync(file)){ ensureDir(path.dirname(file)); fs.writeFileSync(file, content, 'utf8'); }
}
function moveIfExists(src, dst){
  if(fs.existsSync(src)){
    ensureDir(path.dirname(dst));
    fs.renameSync(src, dst);
    console.log('moved:', src, '→', dst);
  }
}
function upsertEnvVar(name, val){
  const envPath = p('.env');
  let txt = fs.existsSync(envPath) ? fs.readFileSync(envPath,'utf8') : '';
  const re = new RegExp(`^${name}=.*$`, 'm');
  if(re.test(txt)){ txt = txt.replace(re, `${name}=${val}`); }
  else { txt += (txt.endsWith('\n')?'':'\n') + `${name}=${val}\n`; }
  fs.writeFileSync(envPath, txt, 'utf8');
}

// Exemplos mínimos (apenas para scaffold)
const CORE_INTENT = `// src/core/intent.js
export function intentOf(text){
  const t=(text||'').toLowerCase().trim();
  if(/^(oi|olá|ola|bom dia|boa tarde|boa noite)\\b/.test(t)) return 'greet';
  if(/(frizz|volume|alinhamento|cabelo|cachead|ondulad|liso|crespo)/.test(t)) return 'qualify';
  if(/(preço|valor|quanto|custa|r\\$|\\d+,\\d{2})/.test(t)) return 'offer';
  if(/(comprar|fechar|link|checkout|quero|finalizar)/.test(t)) return 'close';
  if(/(paguei|comprovante|enviei|pago|pedido)/.test(t)) return 'post_sale';
  if(/(entrega|prazo|frete|dias|chega)/.test(t)) return 'delivery';
  if(/(pagamento|pix|cart[aã]o|boleto|cod|contra entrega)/.test(t)) return 'payment';
  if(/(como usa|modo de uso|aplicar|aplicação)/.test(t)) return 'features';
  if(/(caro|confian[çc]a|anvisa|medo|golpe)/.test(t)) return 'objection';
  return 'other';
}
`;

const CORE_SETTINGS = `// src/core/settings.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..', '..');

function env(n,d){ const v=process.env[n]; return (v===undefined||v===null||v==='')?d:v; }
export const BOT_ID = env('BOT_ID','claudia');

const YAML_PATH = path.join(ROOT,'configs','bots',BOT_ID,'settings.yaml');

let settings = {
  bot_id: BOT_ID,
  persona_name: 'Atendente',
  product: { price_original:197, price_target:170, checkout_link:'', coupon_code:'' },
  flags: { has_cod:true, send_opening_photo:true },
  models_by_stage: {}
};

try{
  if(fs.existsSync(YAML_PATH)){
    const txt = fs.readFileSync(YAML_PATH,'utf8');
    const yml = YAML.parse(txt)||{};
    settings = { ...settings, ...yml };
    console.log('[SETTINGS] Carregado', YAML_PATH);
  }else{
    console.warn('[SETTINGS] YAML não encontrado em', YAML_PATH);
  }
}catch(e){
  console.warn('[SETTINGS] Falha ao ler YAML:', e?.message||e);
}
export { settings };
`;

const FLOW_GREET = (name)=>`// src/bots/${name}/flows/greet.js
import { settings } from '../../../core/settings.js';
export async function greet(){
  return \`Olá! Eu sou \${settings.persona_name}. Como posso te ajudar hoje?\`;
}
`;

const FLOW_QUALIFY = (name)=>`// src/bots/${name}/flows/qualify.js
export async function qualify(){
  return 'Qual é o seu objetivo hoje: alisar, reduzir frizz, baixar volume ou dar brilho?';
}
`;

const FLOW_OFFER = (name)=>`// src/bots/${name}/flows/offer.js
import { settings } from '../../../core/settings.js';
export async function offer(){
  const p = Number(settings?.product?.price_target || 170).toFixed(0);
  return [
    'Condição do dia disponível.',
    \`Preço alvo: R$ \${p}.\`,
    'Quer verificar sua cobertura para pagamento na entrega (COD)?'
  ].join(' ');
}
`;

const FLOW_CLOSE = (name)=>`// src/bots/${name}/flows/close.js
import { settings } from '../../../core/settings.js';
export async function closeDeal(){
  const p = Number(settings?.product?.price_target || 170).toFixed(0);
  const url = settings?.product?.checkout_link || '';
  return [
    \`Perfeito! Fechamos por R$ \${p}.\`,
    url ? 'Te envio o link oficial para concluir.' : 'Sem link disponível neste momento.'
  ].join('\\n');
}
`;

const FLOW_POSTSALE = (name)=>`// src/bots/${name}/flows/postsale.js
export async function postSale(){
  return 'Pedido confirmado! Qualquer dúvida no pós-venda, estou por aqui.';
}
`;

const BOT_ROUTER = `// src/bot.js
import { intentOf } from './core/intent.js';
import { BOT_ID } from './core/settings.js';

let flows = {};
async function loadFlows(botId){
  const g = await import(\`./bots/\${botId}/flows/greet.js\`);
  const q = await import(\`./bots/\${botId}/flows/qualify.js\`);
  const o = await import(\`./bots/\${botId}/flows/offer.js\`);
  const c = await import(\`./bots/\${botId}/flows/close.js\`);
  const p = await import(\`./bots/\${botId}/flows/postsale.js\`);
  return { greet:g.greet, qualify:q.qualify, offer:o.offer, close:c.closeDeal, post_sale:p.postSale };
}
flows = await loadFlows(BOT_ID);
console.log('[BOT] Flows carregados:', BOT_ID);

export const bot = {
  async handleMessage({ userId, text, context }){
    const intent = intentOf(text);
    const fn = flows[intent];
    if(typeof fn === 'function') return await fn({ userId, text, context });
    return 'Certo! Posso te passar a condição do dia ou verificar cobertura para pagamento na entrega.';
  }
};
`;

const DEFAULT_SETTINGS_YAML = (id, name)=>YAML.stringify({
  bot_id: id,
  persona_name: name,
  product: {
    price_original: 197,
    price_target: 170,
    checkout_link: "",
    coupon_code: ""
  },
  flags: { has_cod:true, send_opening_photo:true },
  models_by_stage: { greet:"gpt-4o-mini", qualify:"gpt-4o-mini", offer:"gpt-4o", close:"gpt-4o", postsale:"gpt-4o-mini" }
});

function scaffoldCore(){
  writeIfMissing(p('src/core/intent.js'),   CORE_INTENT);
  writeIfMissing(p('src/core/settings.js'), CORE_SETTINGS);
  writeIfMissing(p('src/bot.js'),           BOT_ROUTER);
}

function scaffoldBot(botId, personaName){
  const base = p('src/bots', botId, 'flows');
  ensureDir(base);
  writeIfMissing(p('src/bots', botId, 'flows/greet.js'),     FLOW_GREET(botId));
  writeIfMissing(p('src/bots', botId, 'flows/qualify.js'),   FLOW_QUALIFY(botId));
  writeIfMissing(p('src/bots', botId, 'flows/offer.js'),     FLOW_OFFER(botId));
  writeIfMissing(p('src/bots', botId, 'flows/close.js'),     FLOW_CLOSE(botId));
  writeIfMissing(p('src/bots', botId, 'flows/postsale.js'),  FLOW_POSTSALE(botId));

  const yml = p('configs/bots', botId, 'settings.yaml');
  writeIfMissing(yml, DEFAULT_SETTINGS_YAML(botId, personaName));
}

function migrateOldFlowsTo(botId){
  const old = p('src/flows');
  if(fs.existsSync(old) && fs.lstatSync(old).isDirectory()){
    const dest = p('src/bots', botId, 'flows');
    ensureDir(dest);
    for(const f of fs.readdirSync(old)){
      const src = path.join(old, f);
      const dst = path.join(dest, f);
      if(fs.lstatSync(src).isFile()){
        moveIfExists(src, dst);
      }
    }
    try{ fs.rmdirSync(old); }catch{}
  }
}

function setActiveBot(botId){
  upsertEnvVar('BOT_ID', botId);
  console.log('BOT_ID definido em .env =', botId);
}

function help(){
  console.log(`
Matrix Scaffold

Comandos:
  node tools/scaffold-bot.mjs init
      → Cria core + bot padrão e define BOT_ID=claudia

  node tools/scaffold-bot.mjs add <bot_id> [Persona Name]
      → Cria estrutura para uma nova vendedora (flows + settings.yaml)

Exemplos:
  node tools/scaffold-bot.mjs init
  node tools/scaffold-bot.mjs add livia "Lívia"
`);
}

(async function main(){
  const [,, cmd, arg1, ...rest] = process.argv;

  if(cmd === 'init'){
    scaffoldCore();
    scaffoldBot('claudia','Atendente');
    migrateOldFlowsTo('claudia');
    setActiveBot('claudia');
    console.log('✅ Estrutura básica criada.');
    return;
  }

  if(cmd === 'add'){
    const id = (arg1||'').trim();
    if(!id) return help();
    const name = (rest.join(' ').trim() || id[0].toUpperCase()+id.slice(1));
    scaffoldBot(id, name);
    console.log(`✅ Bot "${id}" criada com persona "${name}". Use: BOT_ID=${id}`);
    return;
  }

  help();
})();
