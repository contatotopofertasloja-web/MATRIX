-- Primeiro estruturamos o ambiente principal ("O Schema")
CREATE SCHEMA IF NOT EXISTS "03_prospecta";

-- Em seguida as funções nativas requeridas pelas tabelas (como o seu Trigger de updated_at para Lead Empresas)
CREATE OR REPLACE FUNCTION "03_prospecta".set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-----------------------------------------------------------
-- 1. TABELAS BASE (Sem dependências externas)
-----------------------------------------------------------

CREATE TABLE "03_prospecta".categorias (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  ativo boolean NULL DEFAULT true,
  criado_em timestamp without time zone NULL DEFAULT now(),
  CONSTRAINT categorias_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;


CREATE TABLE "03_prospecta".config_execucao (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  max_results_per_search integer NULL DEFAULT 150,
  delay_ms integer NULL DEFAULT 2000,
  ativo boolean NULL DEFAULT true,
  criado_em timestamp without time zone NULL DEFAULT now(),
  CONSTRAINT config_execucao_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;


CREATE TABLE "03_prospecta".localidades (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pais_codigo text NOT NULL,
  estado text NULL,
  cidade text NOT NULL,
  bairro text NULL,
  termo_busca text NULL,
  status text NULL DEFAULT 'pendente'::text,
  prioridade integer NULL DEFAULT 0,
  tentativas integer NULL DEFAULT 0,
  max_tentativas integer NULL DEFAULT 3,
  worker_id text NULL,
  locked_at timestamp without time zone NULL,
  criado_em timestamp without time zone NULL DEFAULT now(),
  atualizado_em timestamp without time zone NULL DEFAULT now(),
  CONSTRAINT localidades_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;


CREATE TABLE "03_prospecta".lead_empresas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  categoria text NOT NULL,
  categorias_todas text[] NULL,
  bairro text NULL,
  cidade text NULL,
  uf character varying(2) NULL,
  telefone_raw text NULL,
  telefone_wpp character varying(15) NOT NULL,
  ddd character varying(2) NULL,
  is_celular boolean NULL DEFAULT true,
  elegivel_wpp boolean GENERATED ALWAYS AS (is_celular) STORED NULL,
  website text NULL,
  gmaps_url text NULL,
  disparado boolean NULL DEFAULT false,
  disparado_at timestamp with time zone NULL,
  template_usado text NULL,
  respondeu boolean NULL DEFAULT false,
  respondeu_at timestamp with time zone NULL,
  pediu_sair boolean NULL DEFAULT false,
  ignorou boolean NULL DEFAULT false,
  conversa_iniciada boolean NULL DEFAULT false,
  conversa_finalizada boolean NULL DEFAULT false,
  acessou_app boolean NULL DEFAULT false,
  converteu boolean NULL DEFAULT false,
  converteu_at timestamp with time zone NULL,
  desfecho text NULL,
  motivo_nao_conversao text NULL,
  motivo_conversao text NULL,
  source text NULL DEFAULT 'gmaps_scraper'::text,
  active boolean NULL DEFAULT true,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  CONSTRAINT lead_empresas_pkey PRIMARY KEY (id),
  CONSTRAINT lead_empresas_desfecho_check CHECK ((desfecho = ANY (ARRAY['convertido'::text, 'sem_interesse'::text, 'sair'::text, 'ignorou'::text, 'desistiu_na_conversa'::text])))
) TABLESPACE pg_default;


-- Índices da "Tabela Rainha" de Leads, incluindo Anti-Duplicidade de Telefone
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_empresas_telefone_unique ON "03_prospecta".lead_empresas USING btree (telefone_wpp) WHERE (active = true) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_lead_empresas_status ON "03_prospecta".lead_empresas USING btree (disparado, respondeu, desfecho) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_lead_empresas_categoria ON "03_prospecta".lead_empresas USING btree (categoria) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_lead_empresas_elegivel ON "03_prospecta".lead_empresas USING btree (elegivel_wpp) WHERE ((elegivel_wpp = true) AND (active = true)) TABLESPACE pg_default;
CREATE TRIGGER trg_lead_empresas_updated_at BEFORE UPDATE ON "03_prospecta".lead_empresas FOR EACH ROW EXECUTE FUNCTION "03_prospecta".set_updated_at();

-----------------------------------------------------------
-- 2. TABELAS RELACIONAIS (Cérebros e Conversas)
-----------------------------------------------------------

CREATE TABLE "03_prospecta".execucoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  localidade_id uuid NULL,
  categoria_id uuid NULL,
  status text NULL DEFAULT 'pendente'::text,
  prioridade integer NULL DEFAULT 0,
  tentativas integer NULL DEFAULT 0,
  max_tentativas integer NULL DEFAULT 3,
  worker_id text NULL,
  locked_at timestamp without time zone NULL,
  ultimo_processamento timestamp without time zone NULL,
  criado_em timestamp without time zone NULL DEFAULT now(),
  horario_inicio time without time zone NULL,
  horario_fim time without time zone NULL,
  dias_semana integer[] NULL DEFAULT '{1,2,3,4,5,6,7}'::integer[],
  CONSTRAINT execucoes_pkey PRIMARY KEY (id),
  CONSTRAINT execucoes_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES "03_prospecta".categorias(id),
  CONSTRAINT execucoes_localidade_id_fkey FOREIGN KEY (localidade_id) REFERENCES "03_prospecta".localidades(id)
) TABLESPACE pg_default;


CREATE TABLE "03_prospecta".lead_conversas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  direcao text NOT NULL,
  mensagem text NULL,
  timestamp_msg timestamp with time zone NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT lead_conversas_pkey PRIMARY KEY (id),
  CONSTRAINT lead_conversas_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES "03_prospecta".lead_empresas(id),
  CONSTRAINT lead_conversas_direcao_check CHECK ((direcao = ANY (ARRAY['entrada'::text, 'saida'::text])))
) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_lead_conversas_lead ON "03_prospecta".lead_conversas USING btree (lead_id) TABLESPACE pg_default;


CREATE TABLE "03_prospecta".lead_desfechos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  resumo text NULL,
  sentimento text NULL,
  objecoes text[] NULL,
  interesse_em text[] NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  CONSTRAINT lead_desfechos_pkey PRIMARY KEY (id),
  CONSTRAINT lead_desfechos_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES "03_prospecta".lead_empresas(id),
  CONSTRAINT lead_desfechos_sentimento_check CHECK ((sentimento = ANY (ARRAY['positivo'::text, 'neutro'::text, 'negativo'::text])))
) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_lead_desfechos_lead ON "03_prospecta".lead_desfechos USING btree (lead_id) TABLESPACE pg_default;

-----------------------------------------------------------
-- 3. VIEWS E PAINÉIS 
-----------------------------------------------------------

CREATE OR REPLACE VIEW "03_prospecta".vw_funil AS
SELECT count(*) FILTER (WHERE active = true) AS total_leads,
    count(*) FILTER (WHERE elegivel_wpp = true AND active = true) AS elegiveis_wpp,
    count(*) FILTER (WHERE disparado = true) AS disparados,
    count(*) FILTER (WHERE respondeu = true) AS responderam,
    count(*) FILTER (WHERE pediu_sair = true) AS pediram_sair,
    count(*) FILTER (WHERE ignorou = true) AS ignoraram,
    count(*) FILTER (WHERE conversa_iniciada = true) AS conversas_iniciadas,
    count(*) FILTER (WHERE acessou_app = true) AS acessaram_app,
    count(*) FILTER (WHERE converteu = true) AS convertidos,
    round(100.0 * count(*) FILTER (WHERE respondeu = true)::numeric / NULLIF(count(*) FILTER (WHERE disparado = true), 0)::numeric, 1) AS taxa_resposta_pct,
    round(100.0 * count(*) FILTER (WHERE converteu = true)::numeric / NULLIF(count(*) FILTER (WHERE disparado = true), 0)::numeric, 1) AS taxa_conversao_pct
FROM "03_prospecta".lead_empresas;
