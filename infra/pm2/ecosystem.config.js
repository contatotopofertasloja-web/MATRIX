// ecosystem.config.js — PM2 config para produção na VPS Hostinger
// TODO: quando houver 3+ apps em produção, migrar para Docker Compose (ver infra/docker/)

const APP_DIR = '/var/www/matrix'

module.exports = {
  apps: [
    // -------------------------------------------------------------------------
    // Next.js — apps/web (porta 3000)
    // -------------------------------------------------------------------------
    {
      name: 'matrix-web',
      cwd: `${APP_DIR}/apps/web`,
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: `${APP_DIR}/logs/web-error.log`,
      out_file: `${APP_DIR}/logs/web-out.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // -------------------------------------------------------------------------
    // Fastify API — apps/api (porta 3001)
    // -------------------------------------------------------------------------
    {
      name: 'matrix-api',
      cwd: `${APP_DIR}/apps/api`,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: `${APP_DIR}/logs/api-error.log`,
      out_file: `${APP_DIR}/logs/api-out.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // -------------------------------------------------------------------------
    // Matrix WhatsApp bot — src/ (porta 3002)
    // -------------------------------------------------------------------------
    {
      name: 'matrix-wpp',
      cwd: APP_DIR,
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
      error_file: `${APP_DIR}/logs/wpp-error.log`,
      out_file: `${APP_DIR}/logs/wpp-out.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
