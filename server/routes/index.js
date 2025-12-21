// Route registry and dispatcher
//
// This module exposes a single entry `routeRequest(req,res,ctx)` that iterates an
// ordered registry of route handlers. Ordering is an invariant and must remain
// identical to the previous implementation to avoid changing behavior.
//
// Handlers keep the same signature: (req, res, ctx) => boolean|Promise<boolean>.
// The first handler returning true stops iteration. Matching logic and route
// paths remain unchanged; this file only organizes dispatch.
import { sendJson, sendText, readBuffer } from '../lib/http.js';
import { routePages } from './pages.js';
import { routeBlocks } from './blocks.js';
import { routeSearch } from './search.js';
import { routeBacklinks } from './backlinks.js';
import { routeUserState } from './userState.js';
import path from 'node:path';
import fs from 'node:fs';

// Handles all known routes. Returns true if handled.
// Inline route handlers for non-module routes. Logic preserved exactly.
function routeHealth(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, dataDir: ctx.DATA_DIR, staticDir: ctx.STATIC_DIR });
    return true;
  }
  return false;
}

function routeMeta(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  if (pathname === '/api/meta' && req.method === 'GET') {
    let schemaVersion = null;
    try {
      const row = ctx.db.prepare('SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 1').get();
      schemaVersion = row?.filename || null;
    } catch {}
    sendJson(res, 200, { dataRoot: ctx.DATA_DIR, dbPath: ctx.DB_FILE_PATH, schemaVersion });
    return true;
  }
  return false;
}

async function routeExport(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  if (pathname === '/api/export' && req.method === 'GET') {
    try {
      const exportsDir = path.join(ctx.DATA_DIR, 'vault', 'exports');
      fs.mkdirSync(exportsDir, { recursive: true });
      const ts = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = `${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
      const exportPath = path.join(exportsDir, `vault-export-${stamp}.sqlite`);
      if (typeof ctx.db.backup === 'function') {
        await ctx.db.backup(exportPath);
      } else {
        try { ctx.db.pragma('wal_checkpoint(FULL)'); } catch {}
        ctx.db.exec(`VACUUM INTO '${exportPath.replace(/'/g, "''")}'`);
      }
      const filename = `dm-vault-${stamp}.sqlite`;
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}` + `"`
      });
      fs.createReadStream(exportPath).pipe(res);
    } catch (e) {
      console.error('export failed', e);
      sendText(res, 500, 'export failed');
    }
    return true;
  }
  return false;
}

async function routeImport(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  if (pathname === '/api/import' && req.method === 'POST') {
    try {
      const buf = await readBuffer(req, 100 * 1024 * 1024);
      const vaultDir = path.join(ctx.DATA_DIR, 'vault');
      fs.mkdirSync(vaultDir, { recursive: true });
      const tmp = path.join(vaultDir, 'vault.sqlite.importing');
      fs.writeFileSync(tmp, buf);
      // swap
      try { ctx.db?.close?.(); } catch {}
      const backupPath = path.join(vaultDir, `vault.sqlite.bak-${Date.now()}`);
      if (fs.existsSync(ctx.DB_FILE_PATH)) {
        try { fs.renameSync(ctx.DB_FILE_PATH, backupPath); } catch {}
      }
      fs.renameSync(tmp, ctx.DB_FILE_PATH);
      ctx.reloadDb();
      sendJson(res, 200, { ok: true });
    } catch (e) {
      const status = e?.status || 500;
      console.error('import failed', e);
      sendJson(res, status, { error: 'import failed' });
    }
    return true;
  }
  return false;
}

// Ordered route registry — order is critical and preserved exactly.
const ROUTES = [
  { name: 'health', handle: routeHealth },
  { name: 'pages', handle: routePages },
  { name: 'search', handle: routeSearch },
  { name: 'meta', handle: routeMeta },
  { name: 'export', handle: routeExport },
  { name: 'import', handle: routeImport },
  // Backlinks must precede generic /api/pages/:id
  { name: 'backlinks', handle: routeBacklinks },
  { name: 'blocks', handle: routeBlocks },
  { name: 'userState', handle: routeUserState },
];

// Handles all known routes. Returns true if handled.
export async function routeRequest(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  for (const r of ROUTES) {
    const handled = await r.handle(req, res, ctx);
    if (handled) return true;
  }

  // Unknown API route
  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'unknown api route' });
    return true;
  }

  return false;
}
