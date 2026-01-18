import fs from 'node:fs';
import path from 'node:path';

function readMigrationsDir() {
  return path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations');
}

export function cleanMigrationSql(sql, filename) {
  const lines = sql.split(/\r?\n/);
  let stripped = false;
  const cleaned = lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('--')) return true;
    const noSemi = trimmed.replace(/;\s*$/, '');
    if (/^BEGIN\s+TRANSACTION$/i.test(noSemi)) { stripped = true; return false; }
    if (/^COMMIT$/i.test(noSemi)) { stripped = true; return false; }
    return true;
  }).join('\n');
  if (stripped) {
    console.warn(`Stripped explicit transaction statements from migration ${filename}. Migrations must not include BEGIN/COMMIT.`);
  }
  return cleaned.trim();
}

export function migrate(db) {
  const migDir = readMigrationsDir();
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at INTEGER NOT NULL);`);

  const applied = new Set(db.prepare('SELECT filename FROM schema_migrations ORDER BY id').all().map(r => r.filename));
  const files = fs.readdirSync(migDir).filter(f => /\d+_.+\.sql$/.test(f)).sort();
  const nowTs = () => Math.floor(Date.now() / 1000);

  for (const f of files) {
    if (applied.has(f)) continue;
    const rawSql = fs.readFileSync(path.join(migDir, f), 'utf8');
    const sql = cleanMigrationSql(rawSql, f);
    const trx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(filename, applied_at) VALUES (?, ?)').run(f, nowTs());
    });
    trx();
  }
}

