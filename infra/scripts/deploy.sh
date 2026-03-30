#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Atualiza a VPS Hostinger via Git
# =============================================================================
# Uso: bash deploy.sh [app]
#   app: web | api | wpp | all (padrão: all)
#
# Exemplos:
#   bash deploy.sh          → deploya tudo
#   bash deploy.sh web      → só o Next.js
#   bash deploy.sh api      → só o Fastify
#   bash deploy.sh wpp      → só o bot WhatsApp
# =============================================================================

set -euo pipefail

APP_DIR="/var/www/matrix"
TARGET="${1:-all}"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
info()  { echo -e "${BLUE}[→]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# -----------------------------------------------------------------------------
# 1. Pull do repositório
# -----------------------------------------------------------------------------
info "Atualizando código em ${APP_DIR}..."
cd "$APP_DIR"
git fetch origin main
git reset --hard origin/main
log "Código atualizado ($(git rev-parse --short HEAD))"

# -----------------------------------------------------------------------------
# 2. Instala dependências
# -----------------------------------------------------------------------------
info "Instalando dependências..."
pnpm install --frozen-lockfile
log "Dependências instaladas"

# -----------------------------------------------------------------------------
# 3. Build e restart por app
# -----------------------------------------------------------------------------
deploy_web() {
  info "Build: apps/web..."
  pnpm --filter @matrix/web build
  pm2 restart matrix-web --update-env
  log "matrix-web reiniciado"
}

deploy_api() {
  info "Build: apps/api..."
  pnpm --filter @matrix/api build
  pm2 restart matrix-api --update-env
  log "matrix-api reiniciado"
}

deploy_wpp() {
  info "Reiniciando matrix-wpp..."
  pm2 restart matrix-wpp --update-env
  log "matrix-wpp reiniciado"
}

case "$TARGET" in
  web)  deploy_web ;;
  api)  deploy_api ;;
  wpp)  deploy_wpp ;;
  all)
    deploy_web
    deploy_api
    deploy_wpp
    ;;
  *)
    error "App desconhecido: '${TARGET}'. Use: web | api | wpp | all"
    ;;
esac

# -----------------------------------------------------------------------------
# 4. Salva estado do PM2
# -----------------------------------------------------------------------------
pm2 save
log "Estado do PM2 salvo"

# -----------------------------------------------------------------------------
# 5. Status final
# -----------------------------------------------------------------------------
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Deploy concluído: ${TARGET}${NC}"
echo -e "${GREEN}============================================${NC}"
pm2 list
