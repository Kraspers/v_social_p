const { Pool } = require('pg');
const env = require('./env');

const pool = env.databaseUrl
  ? new Pool({ connectionString: env.databaseUrl })
  : null;

const missingDbError = new Error(
  'Database is not configured. Set DATABASE_URL (or POSTGRES_URL/RENDER_POSTGRES_URL).'
);

module.exports = {
  isConfigured: Boolean(env.databaseUrl),
  query: (text, params) => {
    if (!pool) throw missingDbError;
    return pool.query(text, params);
  },
  getClient: () => {
    if (!pool) throw missingDbError;
    return pool.connect();
  },
  end: () => (pool ? pool.end() : Promise.resolve())
};
