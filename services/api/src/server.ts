import { createApp } from './app.js';
import { config } from './config.js';
import { closeConnections } from './db/pool.js';

const server = createApp().listen(config.PORT, '0.0.0.0', () => {
  console.info(`API запущено на порту ${config.PORT}`);
});

async function shutdown() {
  server.close(async () => {
    await closeConnections();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
