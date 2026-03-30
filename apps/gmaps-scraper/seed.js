import { supabase } from './supabaseClient.js';
import { config } from './config.js';

const db = supabase.schema('03_prospecta');

async function seedDatabase() {
  console.log('🚀 Iniciando o Seed do Banco de Dados `03_prospecta`...');

  // 1. Inserir Categorias
  console.log('\n📦 Inserindo Categorias...');
  const catArray = config.categories.map(c => ({ nome: c }));

  const { data: categoriasResult, error: errCat } = await db
    .from('categorias')
    .upsert(catArray, { onConflict: 'nome' })
    .select();

  if (errCat) { console.error('Erro (Categorias):', errCat); return; }
  console.log(`✅ ${categoriasResult?.length || 0} Categorias processadas.`);

  // 2. Inserir Localidades
  console.log('\n🌎 Inserindo Bairros/Cidades...');
  const locArray = config.locations.map(loc => {
    // Ex: "Pinheiros, São Paulo, SP"
    const partes = loc.split(',').map(s => s.trim());
    return {
      pais_codigo: 'BR',
      estado: partes[2] || 'SP',
      cidade: partes[1] || 'São Paulo',
      bairro: partes[0],
      termo_busca: loc,
      status: 'pendente'
    };
  });

  const { data: localidadesResult, error: errLoc } = await db
    .from('localidades')
    .upsert(locArray, { onConflict: 'termo_busca' })
    .select();

  if (errLoc) { console.error('Erro (Localidades):', errLoc); return; }
  console.log(`✅ ${localidadesResult?.length || 0} Localidades processadas.`);

  // 3. Montar as Filas (Execuções)
  console.log('\n⚙️ Montando Fila de Execuções (Bairro x Categoria)...');

  const execucoesLote = [];

  // Pegar as listas atuais pra garantir que temos os IDs do banco
  const { data: catRow } = await db.from('categorias').select('id, nome');
  const { data: locRow } = await db.from('localidades').select('id, termo_busca');

  locRow.forEach(local => {
    catRow.forEach(categoria => {
      execucoesLote.push({
        localidade_id: local.id,
        categoria_id: categoria.id,
        status: 'pendente',
        dias_semana: [1, 2, 3, 4, 5, 6, 7]
      });
    });
  });

  // Insere a Fila Bruta na execucoes
  const { error: errExec } = await db
    .from('execucoes')
    .insert(execucoesLote);

  if (errExec) {
    if (errExec.code === '23505') {
       console.log('⚠️ As execuções já parecem estar preenchidas na fila. Ignorando.');
    } else {
       console.error('Erro ao inserir filas:', errExec);
    }
  } else {
    console.log(`✅ A Fila (Execuções) foi semeada com muito sucesso (${execucoesLote.length} combinações geradas!).`);
  }

  console.log('\n🎉 SEED COMPLETO! O banco está pronto para o Worker começar a puxar jobs.');
  process.exit(0);
}

seedDatabase();
