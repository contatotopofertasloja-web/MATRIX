import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { supabase } from './supabaseClient.js';
import { config } from './config.js';

puppeteer.use(StealthPlugin());

// Retorna se o horário atual está dentro da janela permitida
function isInsideTimeWindow(start_time, end_time) {
  if (!start_time || !end_time) return true; // Se não tiver horário, roda 24/7
  
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [hs, ms] = start_time.split(':').map(Number);
  const [he, me] = end_time.split(':').map(Number);
  
  const startMins = hs * 60 + (ms || 0);
  const endMins = he * 60 + (me || 0);

  if (startMins <= endMins) {
    // Mesma data (Ex: 08:00 as 18:00)
    return currentMinutes >= startMins && currentMinutes < endMins;
  } else {
    // Vira de noite (Ex: 22:00 ás 06:00)
    return currentMinutes >= startMins || currentMinutes < endMins;
  }
}

async function autoScroll(page, maxResults) {
  await page.evaluate(async (limite) => {
    const wrapper = document.querySelector('div[role="feed"]');
    if (!wrapper) return;

    await new Promise((resolve) => {
      let totalHeight = 0;
      let distance = 1000;
      let elementsDrawn = 0;
      let retries = 0;

      const timer = setInterval(() => {
        wrapper.scrollBy(0, distance);
        totalHeight += distance;
        
        const items = wrapper.querySelectorAll('.hfpxzc').length;
        if (items > elementsDrawn) {
          elementsDrawn = items;
          retries = 0;
        } else {
          retries++;
        }

        if (elementsDrawn >= limite || retries >= 15) {
          clearInterval(timer);
          resolve();
        }
      }, 800);
    });
  }, maxResults);
}

// O Loop Infinito do Worker
async function workerLoop() {
  console.log('🤖 Worker Inicializado. Bebendo café e aguardando ordens...');
  
  while (true) {
    try {
      // 1. Coleta a FILA PENDENTE cruzada com as tabelas de Nome/Cidade
      const { data: queue, error: qErr } = await supabase.schema('03_prospecta')
        .from('execucoes')
        .select('*, localidades!inner(termo_busca, cidade, bairro, estado), categorias!inner(nome)')
        .eq('status', 'pendente')
        .order('prioridade', { ascending: false });

      if (qErr) {
        console.error('Erro de conexão ao buscar fila:', qErr.message);
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }

      // 2. Procura um Job que seja de Hoje e do Horário Certo
      let activeJob = null;
      const todayDayIndex = new Date().getDay() + 1; // 1 = Dom, 7 = Sabado (depende do padrão do banco, costuma ser 1..7 ou 0..6)

      for (const job of queue) {
        // Validação da Janela Operacional
        if (isInsideTimeWindow(job.horario_inicio, job.horario_fim)) {
           activeJob = job;
           break;
        }
      }

      if (!activeJob) {
        console.log('💤 Nenhum Job pendente dentro do horário permitido no momento. Dormindo 2 minutos...');
        await new Promise(r => setTimeout(r, 120000));
        continue;
      }

      // 3. LOCK DO JOB (Reserva para mim e bloqueia as outras máquinas)
      console.log(`\n🔒 Fisgando Job [${activeJob.id}]`);
      const { data: lockOk, error: lockErr } = await supabase.schema('03_prospecta')
        .from('execucoes')
        .update({ 
           status: 'em_andamento', 
           worker_id: 'bot_desktop_sp_01', 
           locked_at: new Date().toISOString() 
        })
        .eq('id', activeJob.id)
        .eq('status', 'pendente')
        .select();
        
      if (lockErr || !lockOk || lockOk.length === 0) {
        console.log('Alguém foi mais rápido e roubou o Job. Pegando outro...');
        continue;
      }

      // ============================
      // ZONA DE COMBATE (SCRAPING)
      // ============================
      const localidade = activeJob.localidades.termo_busca;
      const categoria = activeJob.categorias.nome;
      const maxResults = config.maxResultsPerSearch || 150;

      const searchQuery = `${categoria} em ${localidade}`;
      console.log(`\n🗺️ Iniciando: "${searchQuery}"`);

      const browser = await puppeteer.launch({
          headless: "new",
          args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });

      await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}?hl=pt-BR`, { waitUntil: 'networkidle2' });

      try {
          await page.waitForSelector('div[role="feed"]', { timeout: 10000 });
          console.log(`  > Rolando a lista do bairro até esgotar...`);
          await autoScroll(page, maxResults);

      } catch (e) {
          console.log(`[Aviso] Nenhum lugar encontrado para "${searchQuery}". Fim.`);
      }

      const items = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a.hfpxzc')).map(c => ({ nome: c.getAttribute('aria-label'), url: c.href }));
      });
      
      const itemsToScrape = items.slice(0, maxResults);
      console.log(`  > Varrendo contatos de ${itemsToScrape.length} locais encontrados...`);

      let cadastrosFeitos = 0;

      for (let i = 0; i < itemsToScrape.length; i++) {
          const item = itemsToScrape[i];

          // Dica: Poderíamos fazer uma query leve no supabase do "nome" pra pular tab (Deduplicação de Nome do plano anterior se você preferir otimização master depois)
          
          try {
              const localPage = await browser.newPage();
              await localPage.goto(item.url, { waitUntil: 'domcontentloaded' });
              await localPage.waitForFunction(() => document.querySelectorAll('button[data-tooltip]').length > 0, { timeout: 5000 }).catch(() => {});

              const { telefone, website } = await localPage.evaluate(() => {
                  let phone = '', web = '';
                  const phoneBtn = document.querySelector('button[data-item-id^="phone:tel:"]');
                  if (phoneBtn) {
                      phone = phoneBtn.getAttribute('aria-label') || '';
                      if (phone.includes('Número de telefone:')) phone = phone.replace('Número de telefone:', '').trim();
                  }
                  const webBtn = document.querySelector('a[data-item-id="authority"]');
                  if (webBtn) web = webBtn.href;
                  return { telefone: phone, website: web };
              });

              await localPage.close();

              if (!telefone) {
                continue; // Google não tem telefone cadastrado
              }

              // ============================
              // INSERÇÃO DIRETA (A MÁGICA)
              // ============================
              // O Supabase vai rejeitar automaticamente se o telefone já existir via Constraint
              
              // O seu schema definiu limite de 15 caracteres no DB para varchar. O Google traz espaços e parênteses grandes.
              // Vamos extirpar qualquer letra/símbolo e deixar só os números crus para o Whatsapp:
              const telefoneLimpo = telefone.replace(/\D/g, ''); 

              const payload = {
                nome: item.nome,
                categoria: categoria,
                cidade: activeJob.localidades.cidade,
                bairro: activeJob.localidades.bairro,
                uf: activeJob.localidades.estado,
                telefone_wpp: telefoneLimpo.substring(0, 15), 
                telefone_raw: telefone,
                website: website,
                gmaps_url: item.url
              };

              const { error: insertErr } = await supabase.schema('03_prospecta').from('lead_empresas').insert(payload);

              if (insertErr) {
                 if (insertErr.code === '23505') { // Chave Duplicada PGSQL
                     console.log(`    > 🚫 Bloqueado: ${item.nome} (O banco de dados já possui o telefone ${telefone})`);
                 } else {
                     console.log(`    > 🐞 Erro ao inserir ${item.nome}:`, insertErr.message);
                 }
              } else {
                 console.log(`    > ✅ Registrado Novo Lead: ${item.nome} | ${telefone}`);
                 cadastrosFeitos++;
              }

          } catch (e) {
              // Timeouts da aba
          }
      }

      await browser.close();

      // ============================
      // CONCLUIR E FECHAR O JOB
      // ============================
      const { error: endErr } = await supabase.schema('03_prospecta')
        .from('execucoes')
        .update({
          status: 'concluida',
          ultimo_processamento: new Date().toISOString(),
          tentativas: lockOk[0].tentativas + 1
        })
        .eq('id', activeJob.id);

      console.log(`\n🎉 Job Finalizado! Foram extraídos e salvos ${cadastrosFeitos} leads únicos.\n`);

      // Pausa aleatória entre 2 a 5 minutos para simulação de comportamento humano e proteção do IP (Google)
      const delayMins = Math.floor(Math.random() * (5 - 2 + 1) + 2);
      console.log(`⏳ Proteção de IP: O Worker tirará um descanso de ${delayMins} minuto(s) antes do próximo pacote...\n`);
      await new Promise(r => setTimeout(r, delayMins * 60000));

    } catch (globalE) {
      console.error('Falha severa no ciclo. Reiniciando logica em 10s...', globalE);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

workerLoop();
