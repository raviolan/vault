#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDataRoot } from '../server/lib/paths.js';

function usage() {
  console.log('Usage: node scripts/restore.mjs <backup.tgz>');
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

try {
  const src = process.argv[2];
  if (!src) { usage(); process.exit(2); }
  const absSrc = path.resolve(src);
  if (!fs.existsSync(absSrc)) { console.error('Backup file not found:', absSrc); process.exit(2); }

  const DATA_DIR = getDataRoot();
  const VAULT_DIR = path.join(DATA_DIR, 'vault');
  const USER_DIR = path.join(DATA_DIR, 'user');
  const MEDIA_DIR = path.join(DATA_DIR, 'media');
  ensureDir(VAULT_DIR); ensureDir(USER_DIR); ensureDir(MEDIA_DIR);

  // Extract to temp
  const tmp = path.resolve(`.restore-${Date.now()}`);
  ensureDir(tmp);
  const tar = spawnSync('tar', ['-xzf', absSrc, '-C', tmp], { stdio: 'inherit' });
  if (tar.status !== 0) { console.error('Failed to extract archive.'); process.exit(tar.status || 1); }

  const extractedRoot = path.join(tmp, 'data');
  if (!fs.existsSync(extractedRoot)) {
    console.error('Archive does not contain top-level `data/`.');
    process.exit(2);
  }

  // Restore DB (backup existing)
  const srcDb = path.join(extractedRoot, 'vault', 'vault.sqlite');
  if (fs.existsSync(srcDb)) {
    const dstDb = path.join(VAULT_DIR, 'vault.sqlite');
    if (fs.existsSync(dstDb)) {
      const bak = path.join(VAULT_DIR, `vault.sqlite.bak-${Date.now()}`);
      try { fs.renameSync(dstDb, bak); console.log('Backed up existing DB to', bak); } catch {}
    }
    ensureDir(VAULT_DIR);
    fs.copyFileSync(srcDb, path.join(VAULT_DIR, 'vault.sqlite'));
    // If WAL/SHM are present in the archive (fallback mode), restore them as well
    const srcWal = path.join(extractedRoot, 'vault', 'vault.sqlite-wal');
    const srcShm = path.join(extractedRoot, 'vault', 'vault.sqlite-shm');
    try { if (fs.existsSync(srcWal)) fs.copyFileSync(srcWal, path.join(VAULT_DIR, 'vault.sqlite-wal')); } catch {}
    try { if (fs.existsSync(srcShm)) fs.copyFileSync(srcShm, path.join(VAULT_DIR, 'vault.sqlite-shm')); } catch {}
  } else {
    console.warn('No vault.sqlite found in archive; skipping DB restore.');
  }

  // Merge-copy user and media
  const copyRecursive = (from, to) => {
    if (!fs.existsSync(from)) return;
    fs.cpSync(from, to, { recursive: true });
  };
  copyRecursive(path.join(extractedRoot, 'user'), USER_DIR);
  copyRecursive(path.join(extractedRoot, 'media'), MEDIA_DIR);

  // Optional meta/pages
  copyRecursive(path.join(extractedRoot, 'vault', 'pages'), path.join(VAULT_DIR, 'pages'));
  if (fs.existsSync(path.join(extractedRoot, 'vault', 'meta.json'))) {
    ensureDir(VAULT_DIR);
    fs.copyFileSync(path.join(extractedRoot, 'vault', 'meta.json'), path.join(VAULT_DIR, 'meta.json'));
  }

  // Cleanup temp
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

  console.log('Restore complete.');
  console.log('- Data dir:', DATA_DIR);
  console.log('- You can now start the app and verify.');
} catch (err) {
  console.error('Restore failed:', err);
  process.exit(1);
}
