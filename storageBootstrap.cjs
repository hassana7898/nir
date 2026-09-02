const Module = require('module');
const originalLoad = Module._load;
const originalExpress = require('express');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || '';
const DEFAULT_COLLECTION = process.env.STORAGE_COLLECTION || 'poultryData';
const MAX_BODY = process.env.JSON_BODY_LIMIT || '50mb';
const CLOUD_SYNC_URL = (process.env.CLOUD_SYNC_URL || '').replace(/\/$/, '');
const CLOUD_SYNC_TOKEN = process.env.CLOUD_SYNC_TOKEN || '';

let pool = null;
let initPromise = null;

function getPool() {
  if (pool) return pool;
  if (!DATABASE_URL) return null;
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: Number(process.env.DB_POOL_MAX || 10),
  });
  return pool;
}

async function initDb() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const db = getPool();
    if (!db) throw new Error('DATABASE_URL is not configured');
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_storage (
        collection_name TEXT NOT NULL,
        document_id TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (collection_name, document_id)
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS app_storage_updated_at_idx ON app_storage (updated_at DESC)`);
    return db;
  })().catch((error) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

function validCollection(name) {
  return name === DEFAULT_COLLECTION;
}

// Cloudflare is an emergency read replica. Mini PC/PostgreSQL remains the only
// normal write master. A failed cloud mirror never blocks a local transaction.
async function mirrorToCloud(id, data) {
  if (!CLOUD_SYNC_URL) return;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (CLOUD_SYNC_TOKEN) headers.Authorization = `Bearer ${CLOUD_SYNC_TOKEN}`;
    const response = await fetch(`${CLOUD_SYNC_URL}/api/storage/${encodeURIComponent(DEFAULT_COLLECTION)}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Cloud mirror failed (${response.status}) ${body}`);
    }
  } catch (error) {
    console.error('[Cloudflare mirror] non-blocking sync failed:', error);
  }
}

function installStorageApi(app) {
  if (app.__postgresStorageInstalled) return;
  app.__postgresStorageInstalled = true;

  app.use(originalExpress.json({ limit: MAX_BODY }));

  app.get('/api/storage/health', async (_req, res) => {
    try {
      const db = await initDb();
      await db.query('SELECT 1');
      res.json({ status: 'ok', configured: true, database: 'postgresql', collection: DEFAULT_COLLECTION, cloudReplicaConfigured: Boolean(CLOUD_SYNC_URL) });
    } catch (error) {
      console.error('[PostgreSQL] health failed:', error);
      res.status(503).json({ status: 'error', configured: Boolean(DATABASE_URL), database: 'postgresql', error: error.message });
    }
  });

  app.get('/api/storage/:collectionName', async (req, res) => {
    try {
      if (!validCollection(req.params.collectionName)) return res.status(404).json({ error: 'Collection not found' });
      const db = await initDb();
      const result = await db.query(
        'SELECT document_id AS id, data, updated_at FROM app_storage WHERE collection_name = $1 ORDER BY updated_at ASC',
        [req.params.collectionName],
      );
      res.json({ documents: result.rows.map(row => ({ id: row.id, data: row.data, updatedAt: row.updated_at })) });
    } catch (error) {
      console.error('[PostgreSQL] collection read failed:', error);
      res.status(502).json({ error: error.message || 'Database read failed' });
    }
  });

  app.get('/api/storage/:collectionName/:id', async (req, res) => {
    try {
      if (!validCollection(req.params.collectionName)) return res.status(404).json({ error: 'Collection not found' });
      const db = await initDb();
      const result = await db.query(
        'SELECT document_id AS id, data, updated_at FROM app_storage WHERE collection_name = $1 AND document_id = $2 LIMIT 1',
        [req.params.collectionName, req.params.id],
      );
      if (!result.rowCount) return res.json({ exists: false, data: null, id: req.params.id });
      res.json({ exists: true, id: result.rows[0].id, data: result.rows[0].data, updatedAt: result.rows[0].updated_at });
    } catch (error) {
      console.error('[PostgreSQL] document read failed:', error);
      res.status(502).json({ error: error.message || 'Database read failed' });
    }
  });

  app.put('/api/storage/:collectionName/:id', async (req, res) => {
    try {
      if (!validCollection(req.params.collectionName)) return res.status(404).json({ error: 'Collection not found' });
      if (req.body === undefined) return res.status(400).json({ error: 'JSON body is required' });
      const db = await initDb();
      const result = await db.query(
        `INSERT INTO app_storage (collection_name, document_id, data, updated_at)
         VALUES ($1, $2, $3::jsonb, NOW())
         ON CONFLICT (collection_name, document_id)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
         RETURNING document_id AS id, data, updated_at`,
        [req.params.collectionName, req.params.id, JSON.stringify(req.body)],
      );
      const payload = { id: result.rows[0].id, data: result.rows[0].data, updatedAt: result.rows[0].updated_at };
      res.json({ ok: true, ...payload });
      void mirrorToCloud(req.params.id, result.rows[0].data);
    } catch (error) {
      console.error('[PostgreSQL] document write failed:', error);
      res.status(502).json({ error: error.message || 'Database write failed' });
    }
  });
}

function patchedExpress(...args) {
  const app = originalExpress(...args);
  installStorageApi(app);
  return app;
}
Object.setPrototypeOf(patchedExpress, originalExpress);
Object.assign(patchedExpress, originalExpress);

Module._load = function(request, parent, isMain) {
  if (request === 'express') return patchedExpress;
  return originalLoad.apply(this, arguments);
};

process.on('SIGTERM', async () => {
  if (pool) await pool.end().catch(() => {});
});
process.on('SIGINT', async () => {
  if (pool) await pool.end().catch(() => {});
});
