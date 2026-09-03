// Load the repository-local .env before any module reads process.env.
// `override: true` is intentional: a stale global/.env.local DATABASE_URL such as
// the template value with hostname HOST must not override the factory's local DB.
require('dotenv').config({ override: true });
const Module = require('module');
const originalLoad = Module._load;
const originalExpress = require('express');
const { Pool } = require('pg');
const { requireAuth } = require('./serverAuth.cjs');

const DATABASE_URL = process.env.DATABASE_URL || '';
const DEFAULT_COLLECTION = process.env.STORAGE_COLLECTION || 'poultryData';
const MAX_BODY = process.env.JSON_BODY_LIMIT || '50mb';
const CLOUD_SYNC_URL = (process.env.CLOUD_SYNC_URL || '').replace(/\/$/, '');
const CLOUD_SYNC_TOKEN = process.env.CLOUD_SYNC_TOKEN || '';

let pool = null;
let initPromise = null;
let syncTimer = null;
let syncing = false;
let initialSnapshotSynchronized = false;

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

function parseCloudDate(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

async function pullCloudSnapshot(db) {
  if (!CLOUD_SYNC_URL || !CLOUD_SYNC_TOKEN) return;

  const response = await fetch(`${CLOUD_SYNC_URL}/api/storage/${encodeURIComponent(DEFAULT_COLLECTION)}`, {
    method: 'GET',
    headers: { 'X-NIR-Sync-Token': CLOUD_SYNC_TOKEN },
  });
  if (!response.ok) {
    throw new Error(`Cloud snapshot pull failed (${response.status}) ${await response.text().catch(() => '')}`);
  }

  const payload = await response.json();
  const documents = Array.isArray(payload?.documents) ? payload.documents : [];

  // Merge cloud changes into PostgreSQL using updated_at as the conflict rule.
  // Cloud wins only when it is newer; otherwise the local record remains the
  // source of truth and is queued for upload below.
  for (const remote of documents) {
    if (!remote?.id) continue;
    const localResult = await db.query(
      'SELECT data, updated_at FROM app_storage WHERE collection_name=$1 AND document_id=$2 LIMIT 1',
      [DEFAULT_COLLECTION, remote.id]
    );
    const local = localResult.rows[0];
    const remoteTime = parseCloudDate(remote.updatedAt);
    const localTime = local ? new Date(local.updated_at).getTime() : 0;

    if (!local || remoteTime > localTime) {
      await db.query(
        `INSERT INTO app_storage (collection_name, document_id, data, updated_at)
         VALUES ($1,$2,$3::jsonb,$4::timestamptz)
         ON CONFLICT (collection_name,document_id) DO UPDATE SET
           data=EXCLUDED.data, updated_at=EXCLUDED.updated_at`,
        [DEFAULT_COLLECTION, remote.id, JSON.stringify(remote.data ?? {}), remote.updatedAt || new Date().toISOString()]
      );
    }
  }

  // Any local record newer than its cloud counterpart must be sent back to
  // Supabase. This preserves factory-side edits instead of blindly overwriting them.
  const localRows = await db.query(
    'SELECT document_id, data, updated_at FROM app_storage WHERE collection_name=$1',
    [DEFAULT_COLLECTION]
  );
  const remoteById = new Map(documents.map((item) => [item.id, item]));
  for (const row of localRows.rows) {
    const remote = remoteById.get(row.document_id);
    const localTime = new Date(row.updated_at).getTime();
    const remoteTime = remote ? parseCloudDate(remote.updatedAt) : 0;
    if (!remote || localTime > remoteTime) {
      await db.query(
        `INSERT INTO cloud_sync_queue (collection_name, document_id, data, queued_at, attempts, next_attempt_at)
         VALUES ($1,$2,$3::jsonb,NOW(),0,NOW())
         ON CONFLICT (collection_name,document_id) DO UPDATE SET
           data=EXCLUDED.data, queued_at=NOW(), attempts=0, next_attempt_at=NOW()`,
        [DEFAULT_COLLECTION, row.document_id, JSON.stringify(row.data)]
      );
    }
  }
}

async function initDb() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const db = getPool();
    if (!db) throw new Error('DATABASE_URL is not configured');
    await db.query(`CREATE TABLE IF NOT EXISTS app_storage (
      collection_name TEXT NOT NULL,
      document_id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (collection_name, document_id)
    )`);
    await db.query(`CREATE INDEX IF NOT EXISTS app_storage_updated_at_idx ON app_storage (updated_at DESC)`);
    await db.query(`CREATE TABLE IF NOT EXISTS cloud_sync_queue (
      collection_name TEXT NOT NULL,
      document_id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (collection_name, document_id)
    )`);

    if (CLOUD_SYNC_URL && CLOUD_SYNC_TOKEN && !initialSnapshotSynchronized) {
      // IMPORTANT: pull first, then queue only local-newer records. This is the
      // bridge that brings records created on the web back into the factory PC.
      try {
        await pullCloudSnapshot(db);
      } catch (error) {
        // Cloud can be temporarily unavailable. PostgreSQL remains usable and
        // the normal upload queue will retry later.
        console.error('[Cloud snapshot] pull failed:', error?.message || error);
      }
      initialSnapshotSynchronized = true;
    }
    return db;
  })().catch((error) => { initPromise = null; throw error; });
  return initPromise;
}

function validCollection(name) { return name === DEFAULT_COLLECTION; }

async function mirrorToCloud(id, data) {
  if (!CLOUD_SYNC_URL || !CLOUD_SYNC_TOKEN) return false;
  try {
    const response = await fetch(`${CLOUD_SYNC_URL}/api/storage/${encodeURIComponent(DEFAULT_COLLECTION)}/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-NIR-Sync-Token': CLOUD_SYNC_TOKEN }, body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`Cloud mirror failed (${response.status}) ${await response.text().catch(() => '')}`);
    return true;
  } catch (error) { console.error('[Cloud replica] sync failed:', error?.message || error); return false; }
}

async function processCloudQueue() {
  if (syncing || !CLOUD_SYNC_URL || !CLOUD_SYNC_TOKEN || !DATABASE_URL) return;
  syncing = true;
  try {
    const db = await initDb();
    const result = await db.query(`SELECT collection_name, document_id, data FROM cloud_sync_queue WHERE next_attempt_at <= NOW() ORDER BY queued_at ASC LIMIT 25`);
    for (const row of result.rows) {
      const ok = await mirrorToCloud(row.document_id, row.data);
      if (ok) await db.query('DELETE FROM cloud_sync_queue WHERE collection_name=$1 AND document_id=$2', [row.collection_name, row.document_id]);
      else await db.query(`UPDATE cloud_sync_queue SET attempts=attempts+1, next_attempt_at=NOW() + LEAST(INTERVAL '30 minutes', INTERVAL '5 seconds' * POWER(2, LEAST(attempts, 8))) WHERE collection_name=$1 AND document_id=$2`, [row.collection_name, row.document_id]);
    }
  } catch (error) { console.error('[Cloud replica queue] failed:', error?.message || error); }
  finally { syncing = false; }
}

function installStorageApi(app) {
  if (app.__postgresStorageInstalled) return;
  app.__postgresStorageInstalled = true;
  app.use(originalExpress.json({ limit: MAX_BODY }));
  app.use('/api/storage', (req, res, next) => req.path === '/health' ? next() : requireAuth(req, res, next));
  app.get('/api/storage/health', async (_req, res) => {
    try { const db = await initDb(); await db.query('SELECT 1'); const pending = await db.query('SELECT COUNT(*)::int AS count FROM cloud_sync_queue'); res.json({ status:'ok', configured:true, database:'postgresql', collection:DEFAULT_COLLECTION, cloudReplicaConfigured:Boolean(CLOUD_SYNC_URL && CLOUD_SYNC_TOKEN), pendingCloudSync:pending.rows[0].count }); }
    catch (error) { console.error('[PostgreSQL] health failed:', error); res.status(503).json({ status:'error', configured:Boolean(DATABASE_URL), database:'postgresql', error:error.message }); }
  });
  app.get('/api/storage/:collectionName', async (req,res) => {
    try { if(!validCollection(req.params.collectionName)) return res.status(404).json({error:'Collection not found'}); const db=await initDb(); const result=await db.query('SELECT document_id AS id, data, updated_at FROM app_storage WHERE collection_name=$1 ORDER BY updated_at ASC',[req.params.collectionName]); res.json({documents:result.rows.map(row=>({id:row.id,data:row.data,updatedAt:row.updated_at}))}); }
    catch(error){res.status(502).json({error:error.message||'Database read failed'});}
  });
  app.get('/api/storage/:collectionName/:id', async (req,res) => {
    try { if(!validCollection(req.params.collectionName)) return res.status(404).json({error:'Collection not found'}); const db=await initDb(); const result=await db.query('SELECT document_id AS id, data, updated_at FROM app_storage WHERE collection_name=$1 AND document_id=$2 LIMIT 1',[req.params.collectionName,req.params.id]); if(!result.rowCount)return res.json({exists:false,data:null,id:req.params.id}); res.json({exists:true,id:result.rows[0].id,data:result.rows[0].data,updatedAt:result.rows[0].updated_at}); }
    catch(error){res.status(502).json({error:error.message||'Database read failed'});}
  });
  app.put('/api/storage/:collectionName/:id', async (req,res) => {
    try { if(!validCollection(req.params.collectionName))return res.status(404).json({error:'Collection not found'}); if(req.body===undefined)return res.status(400).json({error:'JSON body is required'}); const db=await initDb(); const result=await db.query(`INSERT INTO app_storage (collection_name, document_id, data, updated_at) VALUES ($1,$2,$3::jsonb,NOW()) ON CONFLICT (collection_name,document_id) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW() RETURNING document_id AS id, data, updated_at`,[req.params.collectionName,req.params.id,JSON.stringify(req.body)]); const payload={id:result.rows[0].id,data:result.rows[0].data,updatedAt:result.rows[0].updated_at}; await db.query(`INSERT INTO cloud_sync_queue (collection_name, document_id, data, queued_at, attempts, next_attempt_at) VALUES ($1,$2,$3::jsonb,NOW(),0,NOW()) ON CONFLICT (collection_name,document_id) DO UPDATE SET data=EXCLUDED.data, queued_at=NOW(), attempts=0, next_attempt_at=NOW()`,[req.params.collectionName,req.params.id,JSON.stringify(req.body)]); res.json({ok:true,...payload}); void processCloudQueue(); }
    catch(error){res.status(502).json({error:error.message||'Database write failed'});}
  });
}

function patchedExpress(...args){const app=originalExpress(...args);installStorageApi(app);return app;}
Object.setPrototypeOf(patchedExpress,originalExpress);Object.assign(patchedExpress,originalExpress);
Module._load=function(request,parent,isMain){if(request==='express')return patchedExpress;return originalLoad.apply(this,arguments);};
if(CLOUD_SYNC_URL&&CLOUD_SYNC_TOKEN){syncTimer=setInterval(()=>void processCloudQueue(),10000);if(syncTimer.unref)syncTimer.unref();}
async function shutdown(){if(syncTimer)clearInterval(syncTimer);if(pool)await pool.end().catch(()=>{});}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
