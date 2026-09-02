const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const DATABASE_URL = process.env.DATABASE_URL || '';
const BACKUP_DIR = process.env.NIR_BACKUP_DIR || path.join(process.cwd(), 'backups');
const BACKUP_TIME = process.env.NIR_BACKUP_TIME || '02:00';
const RETENTION_DAYS = Math.max(1, Number(process.env.NIR_BACKUP_RETENTION_DAYS || 30));

function findPgDump() {
  if (process.env.PG_DUMP_PATH) return process.env.PG_DUMP_PATH;
  if (process.platform !== 'win32') return 'pg_dump';

  const candidates = [
    'C:\\Program Files\\PostgreSQL',
    'C:\\Program Files (x86)\\PostgreSQL',
    process.env.ProgramW6432 ? path.join(process.env.ProgramW6432, 'PostgreSQL') : null,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'PostgreSQL') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'PostgreSQL') : null
  ].filter(Boolean);

  for (const root of candidates) {
    try {
      if (!fs.existsSync(root)) continue;
      const versions = fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const version of versions) {
        const exe = path.join(root, version, 'bin', 'pg_dump.exe');
        if (fs.existsSync(exe)) return exe;
      }
    } catch {}
  }
  return 'pg_dump';
}

const PG_DUMP_PATH = findPgDump();

let timer = null;
let running = false;
let lastBackup = null;
let lastError = null;

function ensureDir() { fs.mkdirSync(BACKUP_DIR, { recursive: true }); }
function localDateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

function backupFiles() {
  ensureDir();
  return fs.readdirSync(BACKUP_DIR).filter(name => /^nir_\d{8}_\d{6}\.dump$/i.test(name)).map(name => {
    const full = path.join(BACKUP_DIR, name); const stat = fs.statSync(full); return { name, path: full, mtimeMs: stat.mtimeMs, size: stat.size };
  }).sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function hasBackupForDate(date) { const key = localDateKey(date); return backupFiles().some(file => localDateKey(new Date(file.mtimeMs)) === key); }

function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of backupFiles()) if (file.mtimeMs < cutoff) { try { fs.unlinkSync(file.path); } catch (error) { console.error('[NIR Backup] prune failed:', error?.message || error); } }
}

function runBackup(reason = 'scheduled') {
  if (running) return Promise.resolve({ ok: false, skipped: true, reason: 'already-running' });
  if (!DATABASE_URL) { lastError = 'DATABASE_URL is not configured.'; return Promise.resolve({ ok: false, error: lastError }); }
  ensureDir(); running = true; lastError = null;
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const fileName = `nir_${stamp}.dump`; const output = path.join(BACKUP_DIR, fileName);
  return new Promise((resolve) => {
    const child = spawn(PG_DUMP_PATH, [DATABASE_URL, '--format=custom', `--file=${output}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: process.env });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => { running = false; lastError = `pg_dump اجرا نشد: ${error.message} | مسیر: ${PG_DUMP_PATH}`; try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch {} console.error('[NIR Backup]', lastError); resolve({ ok: false, error: lastError }); });
    child.on('close', code => {
      running = false;
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) {
        const stat = fs.statSync(output); lastBackup = { name: fileName, createdAt: now.toISOString(), size: stat.size, reason }; pruneOldBackups(); console.log(`[NIR Backup] success: ${fileName}`); resolve({ ok: true, backup: lastBackup });
      } else { try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch {} lastError = stderr.trim() || `pg_dump با کد ${code} متوقف شد.`; console.error('[NIR Backup]', lastError); resolve({ ok: false, error: lastError }); }
    });
  });
}

function shouldRunNow(now = new Date()) {
  const [hour, minute] = BACKUP_TIME.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || now.getHours() !== hour || now.getMinutes() !== minute) return false;
  return !hasBackupForDate(now);
}

function schedule() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => { const now = new Date(); if (shouldRunNow(now)) void runBackup('scheduled'); }, 60 * 1000);
  if (timer.unref) timer.unref();
  setTimeout(() => { const now = new Date(); const [hour, minute] = BACKUP_TIME.split(':').map(Number); if (Number.isInteger(hour) && Number.isInteger(minute) && now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute && !hasBackupForDate(now)) void runBackup('startup-catchup'); }, 5000);
}

function status() {
  const files = backupFiles(); const newest = files[0] || null;
  return { enabled: Boolean(DATABASE_URL), running, schedule: BACKUP_TIME, retentionDays: RETENTION_DAYS, directory: BACKUP_DIR, hostname: os.hostname(), pgDumpPath: PG_DUMP_PATH, lastBackup: lastBackup || (newest ? { name: newest.name, createdAt: new Date(newest.mtimeMs).toISOString(), size: newest.size, reason: 'existing' } : null), lastError, backups: files.slice(0, 30).map(file => ({ name: file.name, createdAt: new Date(file.mtimeMs).toISOString(), size: file.size })) };
}

function safeBackupPath(name) { if (!/^nir_\d{8}_\d{6}\.dump$/i.test(name)) return null; const resolved = path.resolve(BACKUP_DIR, name); return resolved.startsWith(path.resolve(BACKUP_DIR) + path.sep) ? resolved : null; }

function installAutomaticBackup(app) {
  app.get('/api/backup/status', (_req, res) => res.json(status()));
  app.post('/api/backup/run', async (_req, res) => res.json(await runBackup('manual')));
  app.get('/api/backup/download/:name', (req, res) => { const file = safeBackupPath(req.params.name); if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Backup not found' }); return res.download(file, path.basename(file)); });
  schedule();
}

module.exports = { installAutomaticBackup, runBackup, status };
