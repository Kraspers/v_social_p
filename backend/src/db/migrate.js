const fs = require('fs');
const path = require('path');
const db = require('../config/db');

const run = async () => {
  const dir = path.resolve(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`Applying ${file}`);
    await db.query(sql);
  }

  await db.end();
  console.log('Migrations complete');
};

run().catch(async (err) => {
  console.error(err);
  await db.end();
  process.exit(1);
});
