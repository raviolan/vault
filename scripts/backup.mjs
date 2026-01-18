#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDataRoot } from '../server/lib/paths.js';

function pad(n) { return String(n).padStart(2, '0'); }
function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function copyIfExists(src, dst) {
  if (fs.existsSync(src)) {
    ensureDir(path.dirname(dst));
    fs.cpSync(src, dst, { recursive: true });
  }
}

try {
  const DATA_DIR = getDataRoot();
  const VAULT_DIR = path.join(DATA_DIR, 'vault');
  const DB_PATH = path.join(VAULT_DIR, 'vault.sqlite');
  const EXPORTS_DIR = path.join(VAULT_DIR, 'exports');
  ensureDir(EXPORTS_DIR);

  const ts = timestamp();
  const exportPath = path.join(EXPORTS_DIR, `vault-export-${ts}.sqlite`);

  // Create a consistent DB export (works even if WAL is active)
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database found at ${DB_PATH}`);
    process.exit(2);
  }
  let exported = false;
  try {
    const mod = await import('better-sqlite3');
    const Database = mod.default || mod;
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    try {
      if (typeof db.backup === 'function') {
        await db.backup(exportPath);
      } else {
        try { db.pragma('wal_checkpoint(FULL)'); } catch {}
        db.exec(`VACUUM INTO '${exportPath.replace(/'/g, "''")}'`);
      }
      exported = true;
    } finally {
      try { db.close(); } catch {}
    }
  } catch (e) {
    // Fallback when native module isn't compatible in this environment: raw copy of DB + WAL files
    console.warn('[backup] better-sqlite3 unavailable; falling back to file copy of DB + WAL/SHM.');
  }
  if (!exported) {
    // Copy vault.sqlite plus WAL/SHM into exportPath location
    fs.copyFileSync(DB_PATH, exportPath);
    const wal = `${DB_PATH}-wal`;
    const shm = `${DB_PATH}-shm`;
    try { if (fs.existsSync(wal)) fs.copyFileSync(wal, `${exportPath}-wal`); } catch {}
    try { if (fs.existsSync(shm)) fs.copyFileSync(shm, `${exportPath}-shm`); } catch {}
  }

  // Stage a portable folder structure: top-level `data/` so restore is just extract-at-root
  const stagingRoot = path.resolve(`.backup-staging-${ts}`);
  const stagingData = path.join(stagingRoot, 'data');
  const stagingVault = path.join(stagingData, 'vault');
  ensureDir(stagingVault);

  // Copy exported DB into standard location name
  fs.copyFileSync(exportPath, path.join(stagingVault, 'vault.sqlite'));
  // If WAL/SHM copies were produced by fallback, include them as well
  const expWal = `${exportPath}-wal`;
  const expShm = `${exportPath}-shm`;
  try { if (fs.existsSync(expWal)) fs.copyFileSync(expWal, path.join(stagingVault, 'vault.sqlite-wal')); } catch {}
  try { if (fs.existsSync(expShm)) fs.copyFileSync(expShm, path.join(stagingVault, 'vault.sqlite-shm')); } catch {}

  // Include meta/pages (legacy/aux content), user state, and uploaded media
  copyIfExists(path.join(VAULT_DIR, 'meta.json'), path.join(stagingVault, 'meta.json'));
  copyIfExists(path.join(VAULT_DIR, 'pages'), path.join(stagingVault, 'pages'));
  copyIfExists(path.join(DATA_DIR, 'user'), path.join(stagingData, 'user'));
  copyIfExists(path.join(DATA_DIR, 'media'), path.join(stagingData, 'media'));

  // Create tarball at repo root with `data/` as the top-level entry
  const tarName = `dm-vault-backup-${ts}.tgz`;
  const tarCmd = spawnSync('tar', ['-czf', tarName, '-C', stagingRoot, 'data'], { stdio: 'inherit' });
  if (tarCmd.status !== 0) {
    console.error('Failed to create tarball (is `tar` available in PATH?)');
    process.exit(tarCmd.status || 1);
  }

  // Cleanup staging (keep the export file under data/vault/exports for your records)
  try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch {}

  console.log('Backup complete.');
  console.log(`- Data root: ${DATA_DIR}`);
  console.log(`- DB export: ${exportPath}`);
  console.log(`- Archive:   ${path.resolve(tarName)}`);
  console.log('To migrate, copy the archive to the new machine and extract it at the project root (so it creates ./data).');
  console.log(`Example: tar -xzf ${tarName}`);
} catch (err) {
  console.error('Backup failed:', err);
  process.exit(1);
}
