// PM2: `pm2 start ecosystem.config.cjs` (DEPLOYMENT.md). Un solo proceso: el límite de envíos de correo y los
// temporizadores (retención, cola) viven en el proceso; el modo cluster no se ha probado.
// Node se lanza directamente (interpreter "none"), no a través del contenedor de PM2: api/server.ts sólo arranca si es
// el módulo principal (import.meta.main), y Node carga el .env con --env-file antes de cualquier código.
const path = require('node:path');

// Rutas absolutas desde la ubicación de este archivo: da igual el directorio desde el que se ejecute pm2.
const envFile = path.resolve(__dirname, process.env.CHARALES_ENV_FILE || '.env');

module.exports = {
  apps: [
    {
      name: 'charales-api',
      cwd: __dirname,
      script: process.execPath,
      args: [`--env-file=${envFile}`, 'api/server.ts'],
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      // Una configuración incorrecta sale con código 1 al arrancar: que no reintente sin fin.
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 5000,
      time: true,
    },
  ],
};
