const app = require('./src/app');
const env = require('./src/config/env');
const db = require('./src/config/db');

let server;

const start = async () => {
  await db.query('SELECT 1');
  if (db.mode === 'memory') {
    console.warn('[startup] DATABASE_URL is not set. Running with in-memory PostgreSQL (pg-mem). Data will reset on restart.');
  }

  server = app.listen(env.port, () => {
    console.log(`Backend running on :${env.port}`);
  });
};

const shutdown = async (signal) => {
  console.log(`Received ${signal}, shutting down...`);
  if (server) {
    server.close(async () => {
      await db.end();
      process.exit(0);
    });
  } else {
    await db.end();
    process.exit(0);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception', err);
});

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
