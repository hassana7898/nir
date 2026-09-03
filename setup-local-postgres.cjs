const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const PG_BIN = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const DATA = 'C:\\Program Files\\PostgreSQL\\18\\data';
const HBA = path.join(DATA, 'pg_hba.conf');
const SERVICE = 'postgresql-x64-18';
const ENV_FILE = path.join(ROOT, '.env');
const PSQL = path.join(PG_BIN, 'psql.exe');
const CREATED_PASSWORD = crypto.randomBytes(24).toString('base64url');
const DB_USER = 'nir_app';
const DB_NAME = 'nir';

function run(file, args, options = {}) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: 'pipe', ...options }).trim();
}
function runQuiet(file, args) {
  try { return run(file, args); } catch (e) { return ''; }
}
function sql(q) {
  return run(PSQL, ['-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: '' } });
}
function qIdent(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }
function qLiteral(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }

if (process.platform !== 'win32') { console.error('This setup script is for Windows.'); process.exit(1); }
if (!fs.existsSync(PSQL) || !fs.existsSync(HBA)) { console.error('PostgreSQL 18 was not found at the expected path.'); process.exit(1); }

const backup = HBA + '.nir-backup';
let original;
try {
  original = fs.readFileSync(HBA, 'utf8');
  fs.writeFileSync(backup, original, 'utf8');
  const temporary = original.replace(/^local\s+all\s+all\s+.*$/m, 'local   all             all                                     trust')
    .replace(/^host\s+all\s+all\s+127\.0\.0\.1\/32\s+.*$/m, 'host    all             all             127.0.0.1/32            trust')
    .replace(/^host\s+all\s+all\s+::1\/128\s+.*$/m, 'host    all             all             ::1/128                 trust');
  fs.writeFileSync(HBA, temporary, 'utf8');
  console.log('Temporary local PostgreSQL authentication enabled.');
  runQuiet('sc.exe', ['stop', SERVICE]);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const state = runQuiet('sc.exe', ['query', SERVICE]);
    if (!/STATE\s+:\s+4\s+RUNNING/i.test(state)) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
  run('sc.exe', ['start', SERVICE]);
  const deadline2 = Date.now() + 20000;
  while (Date.now() < deadline2) {
    const state = runQuiet('sc.exe', ['query', SERVICE]);
    if (/STATE\s+:\s+4\s+RUNNING/i.test(state)) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
  sql(`ALTER ROLE ${qIdent(DB_USER)} WITH LOGIN PASSWORD ${qLiteral(CREATED_PASSWORD)};`);
} catch (e) {
  // Role may not exist yet; continue to the CREATE ROLE path.
}

try {
  // The temporary trust rules let us administer the local PostgreSQL instance without knowing the old postgres password.
  sql(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname=${qLiteral(DB_USER)}) THEN CREATE ROLE ${qIdent(DB_USER)} LOGIN PASSWORD ${qLiteral(CREATED_PASSWORD)}; ELSE ALTER ROLE ${qIdent(DB_USER)} WITH LOGIN PASSWORD ${qLiteral(CREATED_PASSWORD)}; END IF; END $$;`);
  const exists = sql(`SELECT 1 FROM pg_database WHERE datname=${qLiteral(DB_NAME)};`);
  if (!exists) sql(`CREATE DATABASE ${qIdent(DB_NAME)} OWNER ${qIdent(DB_USER)};`);
  run(PSQL, ['-h', '127.0.0.1', '-p', '5432', '-U', DB_USER, '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 1;'], { env: { ...process.env, PGPASSWORD: CREATED_PASSWORD } });
  console.log('Local PostgreSQL database ready: nir');
} catch (e) {
  console.error('PostgreSQL setup failed:', e.stderr || e.message || e);
  process.exitCode = 1;
} finally {
  try {
    if (original !== undefined) fs.writeFileSync(HBA, original, 'utf8');
    fs.unlinkSync(backup);
  } catch {}
  runQuiet('sc.exe', ['stop', SERVICE]);
  const deadline3 = Date.now() + 15000;
  while (Date.now() < deadline3) {
    const state = runQuiet('sc.exe', ['query', SERVICE]);
    if (!/STATE\s+:\s+4\s+RUNNING/i.test(state)) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
  try { run('sc.exe', ['start', SERVICE]); } catch {}
}

if (process.exitCode) process.exit(process.exitCode);

let env = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
function setEnv(key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (re.test(env)) env = env.replace(re, line); else env += (env.endsWith('\n') || !env ? '' : '\n') + line + '\n';
}
setEnv('DATABASE_URL', `postgresql://${DB_USER}:${encodeURIComponent(CREATED_PASSWORD)}@127.0.0.1:5432/${DB_NAME}`);
setEnv('DATABASE_SSL', 'false');
setEnv('DB_POOL_MAX', '10');
if (!/^NIR_SESSION_SECRET=.*$/m.test(env) || /change-this-randomly/.test(env)) setEnv('NIR_SESSION_SECRET', crypto.randomBytes(32).toString('hex'));
fs.writeFileSync(ENV_FILE, env, 'utf8');
console.log('D:\\Nir\\.env updated for local PostgreSQL.');
console.log('Next: node reset-password.cjs 881314');
console.log('Then:  npm start');
