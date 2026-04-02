const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { newDb } = require('pg-mem');
const env = require('./env');

let pool;
let mode = 'postgres';
let initPromise = Promise.resolve();

if (env.databaseUrl) {
  pool = new Pool({ connectionString: env.databaseUrl });
} else {
  mode = 'memory';
  const mem = newDb();
  const adapter = mem.adapters.createPg();
  pool = new adapter.Pool();

  const migrationPath = path.resolve(__dirname, '../db/migrations/001_init.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  initPromise = pool.query(sql);
}

module.exports = {
  mode,
  isConfigured: Boolean(env.databaseUrl),
  query: async (text, params) => {
    await initPromise;
    return pool.query(text, params);
  },
  getClient: async () => {
    await initPromise;
    return pool.connect();
  },
  end: () => pool.end()
};
