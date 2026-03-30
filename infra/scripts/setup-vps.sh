#!/usr/bin/env bash
# =============================================================================
# setup-vps.sh — Provisiona VPS Hostinger para o Matrix
# =============================================================================
# Uso: bash setup-vps.sh
# Testado em: Ubuntu 22.04 LTS
# =============================================================================

set -euo pipefail

# --- Cores para output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()    { echo -e "${GREEN}[✓]${NC} $1"; }
info()   { echo -e "${BLUE}[→]${NC} $1"; }
warn()   { echo -e "${YELLOW}[!]${NC} $1"; }
error()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# --- Variáveis ---
NODE_VERSION="20"
PNPM_VERSION="9"
APP_USER="deploy"
APP_DIR="/var/www/matrix"
DOMAIN="${DOMAIN:-}"         # ex: export DOMAIN=meuapp.com antes de rodar
EMAIL="${EMAIL:-}"           # ex: export EMAIL=admin@meuapp.com

# =============================================================================
# 1. Sistema base
# =============================================================================
info "Atualizando sistema..."
apt-get update -qq && apt-get upgrade -y -qq

info "Instalando dependências base..."
apt-get install -y -qq \
  curl wget git unzip \
  build-essential \
  nginx \
  certbot python3-certbot-nginx \
  ufw \
  redis-server \
  htop

# =============================================================================
# 2. Node.js via nvm
# =============================================================================
if ! command -v node &>/dev/null; then
  info "Instalando Node.js ${NODE_VERSION}..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
else
  log "Node.js já instalado: $(node -v)"
fi

# =============================================================================
# 3. pnpm
# =============================================================================
if ! command -v pnpm &>/dev/null; then
  info "Instalando pnpm..."
  npm install -g pnpm@${PNPM_VERSION}
else
  log "pnpm já instalado: $(pnpm -v)"
fi

# =============================================================================
# 4. PM2
# =============================================================================
if ! command -v pm2 &>/dev/null; then
  info "Instalando PM2..."
  npm install -g pm2
  pm2 startup systemd -u root --hp /root
else
  log "PM2 já instalado: $(pm2 -v)"
fi

# =============================================================================
# 5. Usuário de deploy
# =============================================================================
if ! id "$APP_USER" &>/dev/null; then
  info "Criando usuário ${APP_USER}..."
  useradd -m -s /bin/bash "$APP_USER"
  usermod -aG sudo "$APP_USER"
fi

# =============================================================================
# 6. Diretório da aplicação
# =============================================================================
info "Criando diretório da aplicação em ${APP_DIR}..."
mkdir -p "$APP_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# =============================================================================
# 7. Redis — habilita e configura
# =============================================================================
info "Configurando Redis..."
systemctl enable redis-server
systemctl start redis-server
# Bind apenas localhost por segurança
sed -i 's/^bind .*/bind 127.0.0.1/' /etc/redis/redis.conf
systemctl restart redis-server
log "Redis rodando em 127.0.0.1:6379"

# =============================================================================
# 8. Nginx — config base
# =============================================================================
info "Configurando Nginx..."
rm -f /etc/nginx/sites-enabled/default

cat > /etc/nginx/sites-available/matrix << 'EOF'
# Matrix — config base (sem SSL ainda)
# Depois de rodar certbot, este arquivo será atualizado automaticamente.
server {
    listen 80;
    server_name _;

    # Health check
    location /health {
        return 200 'ok';
        add_header Content-Type text/plain;
    }

    # Proxy para Next.js (apps/web) — porta 3000
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Proxy para Fastify API (apps/api) — porta 3001
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/matrix /etc/nginx/sites-enabled/matrix
nginx -t && systemctl reload nginx
log "Nginx configurado"

# =============================================================================
# 9. Firewall
# =============================================================================
info "Configurando UFW..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 'Nginx Full'
ufw --force enable
log "Firewall ativo: SSH + HTTP/HTTPS liberados"

# =============================================================================
# 10. SSL via Certbot (opcional — só roda se DOMAIN e EMAIL estiverem definidos)
# =============================================================================
if [[ -n "$DOMAIN" && -n "$EMAIL" ]]; then
  info "Configurando SSL para ${DOMAIN}..."
  certbot --nginx -d "$DOMAIN" -d "www.${DOMAIN}" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive \
    --redirect
  log "SSL configurado para ${DOMAIN}"
  # Renovação automática
  systemctl enable certbot.timer
  systemctl start certbot.timer
else
  warn "DOMAIN/EMAIL não definidos — SSL pulado. Rode depois:"
  warn "  export DOMAIN=meuapp.com EMAIL=admin@meuapp.com && certbot --nginx -d \$DOMAIN"
fi

# =============================================================================
# 11. Resumo final
# =============================================================================
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  VPS Matrix configurada com sucesso!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "  Node.js : $(node -v)"
echo "  pnpm    : $(pnpm -v)"
echo "  PM2     : $(pm2 -v)"
echo "  Redis   : $(redis-cli ping)"
echo "  Nginx   : $(nginx -v 2>&1)"
echo ""
echo "  App dir : ${APP_DIR}"
echo ""
echo "  Próximos passos:"
echo "  1. Clone o repo em ${APP_DIR}"
echo "  2. Copie o .env de produção"
echo "  3. pnpm install && pnpm build"
echo "  4. pm2 start infra/pm2/ecosystem.config.js"
echo "  5. pm2 save"
echo ""
# TODO: quando houver 3+ apps em produção, substituir PM2 por Docker Compose
# Ver: infra/docker/ (a criar)
