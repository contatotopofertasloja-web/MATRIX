# CLAUDE.md — Matrix Workspace

> Este arquivo é carregado automaticamente em cada sessão.
> Mantenha-o atualizado sempre que houver decisões arquiteturais relevantes.

---

## O que é este workspace

**Matrix** é o workspace principal — uma fábrica de SaaS com automações de IA.
O atendimento via WhatsApp roda na VPS via **Evolution API + n8n**. O código aqui é focado nos apps SaaS.

> ⚠️ `src/` (matrix-wpp/Baileys) e `ANTIGRAVITY/` foram **removidos** — não existem mais.

---

## VPS (laboratório atual — Speedfy)

A infraestrutura roda em VPS gerenciada pelo painel **Speedfy.host**:

| Serviço | Versão | Porta |
|---------|--------|-------|
| OpenResty (Nginx) | 1.27.1 | 80 / 443 |
| PostgreSQL | 17.0 | 5432 |
| Evolution API | v2.3.6 | 8080 |
| Redis | 7.4.1 | 6379 |
| n8n | 2.7.4 | 5678 |

**Migração futura:** quando houver o primeiro produto em produção real, migrar para VPS Hostinger dedicada. O ambiente é idêntico — só trocar IP/SSH nos secrets do GitHub Actions.

---

## WhatsApp / Automações (n8n)

- **WhatsApp:** Evolution API v2.3.6 — não Baileys (abandonado)
- **Orquestração de fluxos:** n8n self-hosted na VPS
- **Sem código de bot local** — tudo vive dentro do n8n

### Credenciais configuradas no n8n

| Credencial | Tipo |
|------------|------|
| Google Drive | OAuth2 |
| Google Sheets | OAuth2 |
| Google Calendar | OAuth2 |
| Google Service Account | Service Account |
| Gmail | OAuth2 |
| Facebook Graph | Graph API |
| WhatsApp / Evolution API | Evolution API |
| Redis | Redis |
| OpenAI | API Key |
| PostgreSQL | Postgres |
| Supabase | Supabase API |

---

## Stack — Apps SaaS (apps/)

```
Monorepo:   pnpm workspaces + Turborepo
Frontend:   Next.js App Router + TypeScript + Tailwind CSS + shadcn/ui  →  apps/web/
Backend:    Fastify + TypeScript                                         →  apps/api/
Auth:       Supabase Auth                           (@boilerplate/auth)
DB:         PostgreSQL via Supabase + Prisma        (@boilerplate/database)
Pagamentos: Stripe (assinaturas + webhooks)         (@boilerplate/billing)
UI:         shadcn/ui padronizado                   (@boilerplate/ui)
```

---

## Estrutura do monorepo

```
Matrix/
├── apps/
│   ├── web/            # Next.js App Router (frontend)
│   ├── api/            # Fastify (backend)
│   └── gmaps-scraper/  # Scraper Google Maps
│
├── packages/
│   ├── auth/           # @boilerplate/auth (Supabase)
│   ├── billing/        # @boilerplate/billing (Stripe)
│   ├── ui/             # @boilerplate/ui (shadcn)
│   └── database/       # @boilerplate/database (Prisma + Supabase)
│
├── infra/
│   ├── nginx/          # config OpenResty/Nginx
│   ├── pm2/            # ecosystem.config.js
│   └── scripts/
│       ├── setup-vps.sh
│       └── deploy.sh
│
├── .github/workflows/  # CI/CD GitHub Actions
├── CLAUDE.md
├── turbo.json
└── package.json        # pnpm workspaces root
```

---

## Variáveis de ambiente (.env)

Redis local na VPS:
```
MATRIX_REDIS_URL=redis://127.0.0.1:6379
```

> ⚠️ Qualquer referência a `${{...}}` é resquício do Railway — não usar mais.

---

## Convenções de banco de dados (Supabase / PostgreSQL)

**Schemas obrigatórios — sempre organizar tabelas por schema:**

Toda proposta de criação de tabela deve incluir o schema. Nunca criar tabelas direto no `public` sem justificativa.

| Schema | Finalidade |
|--------|-----------|
| `public` | Apenas tabelas genéricas sem dono claro (evitar) |
| `auth` | Gerenciado pelo Supabase Auth — não mexer |
| `app` | Tabelas core do produto (ex: `app.profiles`, `app.subscriptions`) |
| `billing` | Tabelas de pagamento/Stripe (ex: `billing.invoices`, `billing.plans`) |
| `whatsapp` | Tabelas relacionadas a automações WhatsApp/n8n |
| `analytics` | Eventos, logs de uso, métricas |

> ⚠️ Ao propor qualquer `CREATE TABLE`, sempre incluir o schema no nome — ex: `CREATE TABLE app.profiles (...)`.
> Criar o schema antes se ainda não existir: `CREATE SCHEMA IF NOT EXISTS app;`

---

## Convenções de código

**Apps (TypeScript):**
- Strict mode ligado
- Zod para validação de qualquer input externo
- Types compartilhados em `@boilerplate/shared-types`
- Fastify para backend — não Next.js API routes
- Pino para logs — nunca `console.log` em produção

---

## Contexto de desenvolvimento

- Prototipagem visual via **Lovable** → contratos de API → código aqui
- Lovable gera o design de referência; o código de produção vive neste repo
- n8n para automações e fluxos de WhatsApp

---

## O que NÃO fazer

- Não referenciar Baileys, matrix-wpp, ANTIGRAVITY — foram abandonados
- Não usar Railway — migrado para fora
- Não adicionar Docker ainda — PM2 é o padrão atual (entra com 3+ apps em produção)
- Não criar Next.js API routes como substituto do Fastify
- Não hardcodar configs — usar `.env`
- Não criar abstrações prematuras para uso único
- Não usar `console.log` — usar Pino
