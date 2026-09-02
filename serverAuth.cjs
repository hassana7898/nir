const crypto = require('crypto');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || '';
const SESSION_COOKIE = 'nir_session';
const SESSION_TTL_MS = Math.max(15 * 60 * 1000, Number(process.env.NIR_SESSION_TTL_MS || 12 * 60 * 60 * 1000));
const SESSION_SECRET = process.env.NIR_SESSION_SECRET || '';

let pool = null;
function getPool() {
  if (pool) return pool;
  if (!DATABASE_URL) return null;
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 3,
  });
  return pool;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('=');
    return i < 0 ? [v, ''] : [decodeURIComponent(v.slice(0, i)), decodeURIComponent(v.slice(i + 1))];
  }));
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt, 'utf8').digest('hex');
}
function timingSafeEqualHex(a, b) {
  try {
    const aa = Buffer.from(a, 'hex'); const bb = Buffer.from(b, 'hex');
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
  } catch { return false; }
}
function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}
function makeSession(passwordHash) {
  if (!SESSION_SECRET) throw new Error('NIR_SESSION_SECRET is not configured');
  const issuedAt = Date.now();
  const payload = `${issuedAt}.${passwordHash}`;
  return `${payload}.${sign(payload)}`;
}
async function getPasswordRecord() {
  const db = getPool();
  if (!db) throw new Error('DATABASE_URL is not configured');
  const result = await db.query(`SELECT document_id, data FROM app_storage WHERE collection_name=$1 AND document_id IN ($2,$3)`, [process.env.STORAGE_COLLECTION || 'poultryData', 'poultryAppPasswordHash', 'poultryAppPasswordSalt']);
  const values = Object.fromEntries(result.rows.map(r => [r.document_id, r.data?.value || '']));
  return { hash: values.poultryAppPasswordHash || '', salt: values.poultryAppPasswordSalt || '' };
}
async function passwordIsSet() { const r = await getPasswordRecord(); return Boolean(r.hash && r.salt); }
async function verifySession(req) {
  if (!SESSION_SECRET) return false;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [issuedAtRaw, passwordHash, signature] = parts;
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt < 0 || Date.now() - issuedAt > SESSION_TTL_MS) return false;
  const payload = `${issuedAt}.${passwordHash}`;
  if (!timingSafeEqualHex(Buffer.from(sign(payload)).toString('hex'), Buffer.from(signature, 'base64url').toString('hex'))) return false;
  const record = await getPasswordRecord();
  return Boolean(record.hash && record.salt && timingSafeEqualHex(passwordHash, record.hash));
}
function cookieOptions(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = forwarded === 'https' || req.secure === true;
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`;
}
function clearCookie(req) { return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${(req.headers['x-forwarded-proto'] || '').includes('https') || req.secure ? '; Secure' : ''}`; }

async function setupPassword(password) {
  if (typeof password !== 'string' || password.length < 4) throw new Error('Password must be at least 4 characters');
  const db = getPool(); if (!db) throw new Error('DATABASE_URL is not configured');
  const existing = await getPasswordRecord();
  if (existing.hash && existing.salt) { const e = new Error('Password is already configured'); e.code = 'PASSWORD_EXISTS'; throw e; }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const collection = process.env.STORAGE_COLLECTION || 'poultryData';
  await db.query('BEGIN');
  try {
    await db.query(`INSERT INTO app_storage (collection_name,document_id,data,updated_at) VALUES ($1,$2,$3::jsonb,NOW()) ON CONFLICT (collection_name,document_id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`, [collection, 'poultryAppPasswordSalt', JSON.stringify({ value: salt })]);
    await db.query(`INSERT INTO app_storage (collection_name,document_id,data,updated_at) VALUES ($1,$2,$3::jsonb,NOW()) ON CONFLICT (collection_name,document_id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`, [collection, 'poultryAppPasswordHash', JSON.stringify({ value: hash })]);
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK'); throw e; }
}

async function login(req, res) {
  const password = req.body?.password;
  if (typeof password !== 'string') return res.status(400).json({ ok: false, error: 'Password is required' });
  const record = await getPasswordRecord();
  if (!record.hash || !record.salt) return res.status(409).json({ ok: false, error: 'Password is not configured' });
  const candidate = hashPassword(password, record.salt);
  if (!timingSafeEqualHex(candidate, record.hash)) return res.status(401).json({ ok: false, error: 'رمز عبور نادرست است.' });
  const token = makeSession(record.hash);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieOptions(req)}`);
  return res.json({ ok: true });
}

async function requireAuth(req, res, next) {
  try {
    if (await verifySession(req)) return next();
    return res.status(401).json({ error: 'احراز هویت لازم است.' });
  } catch (error) { console.error('[NIR Auth]', error?.message || error); return res.status(503).json({ error: 'Authentication service unavailable.' }); }
}

function installAuth(app) {
  app.get('/api/auth/status', async (_req, res) => { try { res.json({ passwordSet: await passwordIsSet() }); } catch (e) { res.status(503).json({ error: e.message || 'Authentication service unavailable.' }); } });
  app.post('/api/auth/setup', async (req, res) => { try { await setupPassword(req.body?.password); res.json({ ok: true }); } catch (e) { res.status(e.code === 'PASSWORD_EXISTS' ? 409 : 400).json({ ok: false, error: e.message || 'Could not set password.' }); } });
  app.post('/api/auth/login', (req, res) => void login(req, res).catch(e => { console.error('[NIR Auth]', e); res.status(503).json({ ok: false, error: 'Authentication service unavailable.' }); }));
  app.post('/api/auth/logout', (req, res) => { res.setHeader('Set-Cookie', clearCookie(req)); res.json({ ok: true }); });
  app.get('/api/auth/session', async (req, res) => { try { res.json({ authenticated: await verifySession(req) }); } catch { res.json({ authenticated: false }); } });
}

module.exports = { installAuth, requireAuth, verifySession, passwordIsSet, setupPassword, SESSION_COOKIE };
