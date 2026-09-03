require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node reset-password.cjs <new-password>');
  process.exit(1);
}
if (password.length < 4) {
  console.error('Password must be at least 4 characters.');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL || '';
const COLLECTION = process.env.STORAGE_COLLECTION || 'poultryData';
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not configured. Check D:\\Nir\\.env');
  process.exit(1);
}

const db = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 2,
});

const hashPassword = (value, salt) => crypto.createHash('sha256').update(value + salt, 'utf8').digest('hex');

(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS app_storage (
      collection_name TEXT NOT NULL,
      document_id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (collection_name, document_id)
    )`);
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    await db.query('BEGIN');
    await db.query(`INSERT INTO app_storage (collection_name,document_id,data,updated_at)
      VALUES ($1,$2,$3::jsonb,NOW())
      ON CONFLICT (collection_name,document_id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`,
      [COLLECTION, 'poultryAppPasswordSalt', JSON.stringify({ value: salt })]);
    await db.query(`INSERT INTO app_storage (collection_name,document_id,data,updated_at)
      VALUES ($1,$2,$3::jsonb,NOW())
      ON CONFLICT (collection_name,document_id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`,
      [COLLECTION, 'poultryAppPasswordHash', JSON.stringify({ value: hash })]);
    await db.query('COMMIT');
    console.log('NIR password reset successfully. Existing application data was not changed.');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('Password reset failed:', error.message || error);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
