import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getDataRoot } from '../lib/paths.js';

const DATA_DIR = getDataRoot();
const VAULT_DIR = path.join(DATA_DIR, 'vault');
const DB_PATH = path.join(VAULT_DIR, 'vault.sqlite');

function ensureDir() {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
}

export function openDb() {
  ensureDir();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export { DATA_DIR, VAULT_DIR, DB_PATH };

