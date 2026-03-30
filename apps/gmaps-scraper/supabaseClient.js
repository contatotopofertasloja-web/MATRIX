import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Carrega as variáveis do arquivo .env
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ ERRO FATAL: Variáveis SUPABASE_URL ou SUPABASE_KEY não configuradas no arquivo .env.");
  process.exit(1);
}

// Inicializa o cliente apontando para o seu banco e para o Schema correto OBRIGATORIAMENTE
export const supabase = createClient(supabaseUrl, supabaseKey, {
  db: {
    schema: '03_prospecta',
  },
});
