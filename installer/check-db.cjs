const { Client } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is empty.');
  process.exit(1);
}

const client = new Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,
});

(async () => {
  try {
    await client.connect();
    await client.query('SELECT 1');
    console.log('PostgreSQL connection: OK');
    await client.end();
  } catch (error) {
    console.error('PostgreSQL connection failed:', error.message);
    try { await client.end(); } catch {}
    process.exit(1);
  }
})();
