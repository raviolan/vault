import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, backfillSlugs, listPages as dbListPages, searchPages as dbSearchPages, getBacklinks as dbGetBacklinks, createPage as dbCreatePage, getPageWithBlocks as dbGetPageWithBlocks, getPageWithBlocksBySlug as dbGetPageWithBlocksBySlug, patchPage as dbPatchPage, deletePage as dbDeletePage, createBlock as dbCreateBlock, patchBlock as dbPatchBlock, deleteBlock as dbDeleteBlock, reorderBlocks as dbReorderBlocks } from './db.js';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);

function resolveStaticDir() {
  const dist = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) return dist;
  return path.resolve(process.cwd(), 'public');
}

// Canonical data root: prefer $DATA_DIR, else /data if present, else ./data
function getDataRoot() {
  const env = process.env.DATA_DIR;
  if (env) return path.resolve(env);
  const dockerPath = '/data';
  try {
    if (fs.existsSync(dockerPath)) return dockerPath;
  } catch {}
  return path.resolve(process.cwd(), 'data');
}

const STATIC_DIR = resolveStaticDir();
const DATA_DIR = getDataRoot();
const DB_FILE_PATH = path.join(DATA_DIR, 'vault', 'vault.sqlite');
const USER_DIR = path.join(DATA_DIR, 'user');

function ensureDirs() {
  fs.mkdirSync(USER_DIR, { recursive: true });
  const userStatePath = path.join(USER_DIR, 'state.json');
  if (!fs.existsSync(userStatePath)) {
    writeJsonAtomic(userStatePath, defaultUserState());
  }
}

function readJson(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(p, obj) {
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function defaultUserState() {
  return {
    leftPanelOpen: true,
    rightPanelOpen: true,
    rightPanelPinned: false,
    rightPanelTab: 'notepad',
    navCollapsed: false,
    notepadText: '',
    todoItems: [],
  };
}

// file-based content renderer removed; client renders blocks

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    ext === '.html' ? 'text/html; charset=utf-8' :
    ext === '.js' ? 'text/javascript; charset=utf-8' :
    ext === '.css' ? 'text/css; charset=utf-8' :
    ext === '.json' ? 'application/json; charset=utf-8' :
    ext === '.svg' ? 'image/svg+xml' :
    ext === '.ico' ? 'image/x-icon' :
    ext === '.map' ? 'application/json; charset=utf-8' :
    'application/octet-stream'
  );
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readBuffer(req, maxBytes = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(text);
}

function safeJoin(root, urlPath) {
  // Prevent path traversal
  const decoded = decodeURIComponent(urlPath);
  const resolved = path.normalize(path.join(root, decoded));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

ensureDirs();

// Initialize DB + run migrations + seed optional welcome page
let db = openDb();
migrate(db);
try { backfillSlugs(db); } catch {}

function reloadDb() {
  try { db?.close?.(); } catch {}
  db = openDb();
  migrate(db);
  try { backfillSlugs(db); } catch {}
}
try {
  const cnt = db.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
  if (!cnt) {
    const page = dbCreatePage(db, { title: 'Welcome to DM Vault', type: 'note' });
    const ts = Math.floor(Date.now() / 1000);
    const insertBlock = db.prepare('INSERT INTO blocks(id, page_id, parent_id, sort, type, props_json, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const b1 = {
      id: randomUUID(),
      sort: 0,
      type: 'heading',
      props: { level: 2 },
      content: { text: 'Hello! Your vault is ready.' },
    };
    insertBlock.run(b1.id, page.id, null, b1.sort, b1.type, JSON.stringify(b1.props), JSON.stringify(b1.content), ts, ts);
    const b2 = {
      id: randomUUID(),
      sort: 1,
      type: 'paragraph',
      props: {},
      content: { text: 'Content is stored locally in a SQLite DB under your data root.' },
    };
    insertBlock.run(b2.id, page.id, null, b2.sort, b2.type, JSON.stringify(b2.props), JSON.stringify(b2.content), ts, ts);
  }
} catch {}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // --- API ---
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/health' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, dataDir: DATA_DIR, staticDir: STATIC_DIR });
      }

      if (pathname === '/api/pages' && req.method === 'GET') {
        sendJson(res, 200, dbListPages(db));
        return;
      }

      if (pathname === '/api/pages' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        if (!body.title) return sendJson(res, 400, { error: 'title required' });
        const page = dbCreatePage(db, { title: String(body.title), type: String(body.type || 'note') });
        sendJson(res, 201, page);
        return;
      }

      // Search pages and paragraphs
      if (pathname === '/api/search' && req.method === 'GET') {
        const q = new URL(req.url, `http://${req.headers.host}`).searchParams.get('q') || '';
        const results = dbSearchPages(db, q, 30);
        sendJson(res, 200, { q, results });
        return;
      }

      // Meta info
      if (pathname === '/api/meta' && req.method === 'GET') {
        let schemaVersion = null;
        try {
          const row = db.prepare('SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 1').get();
          schemaVersion = row?.filename || null;
        } catch {}
        sendJson(res, 200, { dataRoot: DATA_DIR, dbPath: DB_FILE_PATH, schemaVersion });
        return;
      }

      // Export vault (SQLite)
      if (pathname === '/api/export' && req.method === 'GET') {
        try {
          const exportsDir = path.join(DATA_DIR, 'vault', 'exports');
          fs.mkdirSync(exportsDir, { recursive: true });
          const ts = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const stamp = `${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
          const exportPath = path.join(exportsDir, `vault-export-${stamp}.sqlite`);
          if (typeof db.backup === 'function') {
            await db.backup(exportPath);
          } else {
            try { db.pragma('wal_checkpoint(FULL)'); } catch {}
            db.exec(`VACUUM INTO '${exportPath.replace(/'/g, "''")}'`);
          }
          const filename = `dm-vault-${stamp}.sqlite`;
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${filename}"`
          });
          fs.createReadStream(exportPath).pipe(res);
        } catch (e) {
          console.error('export failed', e);
          sendText(res, 500, 'export failed');
        }
        return;
      }

      // Import vault (SQLite)
      if (pathname === '/api/import' && req.method === 'POST') {
        try {
          const buf = await readBuffer(req, 100 * 1024 * 1024);
          const vaultDir = path.join(DATA_DIR, 'vault');
          fs.mkdirSync(vaultDir, { recursive: true });
          const tmp = path.join(vaultDir, 'vault.sqlite.importing');
          fs.writeFileSync(tmp, buf);
          // swap
          try { db?.close?.(); } catch {}
          const backupPath = path.join(vaultDir, `vault.sqlite.bak-${Date.now()}`);
          if (fs.existsSync(DB_FILE_PATH)) {
            try { fs.renameSync(DB_FILE_PATH, backupPath); } catch {}
          }
          fs.renameSync(tmp, DB_FILE_PATH);
          reloadDb();
          sendJson(res, 200, { ok: true });
        } catch (e) {
          const status = e?.status || 500;
          console.error('import failed', e);
          sendJson(res, status, { error: 'import failed' });
        }
        return;
      }

      // Resolve legacy wiki link by title (create if missing)
      if (pathname === '/api/pages/resolve' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        const title = String(body.title || '').trim();
        const type = String(body.type || 'note');
        console.log('resolve route hit', title);
        if (!title) return sendJson(res, 400, { error: 'title required' });
        const row = db.prepare('SELECT id FROM pages WHERE title = ?').get(title);
        if (row) {
          const page = dbGetPageWithBlocks(db, row.id);
          return sendJson(res, 200, { page, created: false });
        }
        const created = dbCreatePage(db, { title, type });
        const page = dbGetPageWithBlocks(db, created.id);
        sendJson(res, 201, { page, created: true });
        return;
      }

      // Fetch page by slug
      const slugMatch = pathname.match(/^\/api\/pages\/slug\/([^\/]+)$/);
      if (slugMatch && req.method === 'GET') {
        const slug = slugMatch[1];
        const page = dbGetPageWithBlocksBySlug(db, slug);
        if (!page) { sendJson(res, 404, { error: 'not found' }); return; }
        sendJson(res, 200, page);
        return;
      }

      // Backlinks for a page (handle before generic /api/pages/:id)
      const backlinksMatch = pathname.match(/^\/api\/pages\/([^\/]+)\/backlinks$/);
      if (backlinksMatch && req.method === 'GET') {
        const id = backlinksMatch[1];
        // Fetch title to include in response and to validate existence
        const page = dbGetPageWithBlocks(db, id);
        if (!page) { sendJson(res, 404, { error: 'not found' }); return; }
        const backlinks = dbGetBacklinks(db, id);
        if (backlinks == null) { sendJson(res, 404, { error: 'not found' }); return; }
        sendJson(res, 200, { pageId: id, title: page.title, backlinks: backlinks });
        return;
      }

      const pageIdMatch = pathname.match(/^\/api\/pages\/([^\/]+)$/);
      if (pageIdMatch) {
        const id = pageIdMatch[1];

        if (req.method === 'GET') {
          const page = dbGetPageWithBlocks(db, id);
          if (!page) { sendJson(res, 404, { error: 'not found' }); return; }
          sendJson(res, 200, page);
          return;
        }

        if (req.method === 'PATCH') {
          const body = JSON.parse(await readBody(req) || '{}');
          console.log('patch page hit', id, body);
          const updated = dbPatchPage(db, id, { title: body.title, type: body.type, regenerateSlug: !!body.regenerateSlug });
          if (!updated) { sendJson(res, 404, { error: 'not found' }); return; }
          sendJson(res, 200, updated);
          return;
        }

        if (req.method === 'DELETE') {
          dbDeletePage(db, id);
          sendJson(res, 200, { ok: true });
          return;
        }
      }

      // (backlinks handled above)

      // Create block for page
      const pageBlocksMatch = pathname.match(/^\/api\/pages\/([^\/]+)\/blocks$/);
      if (pageBlocksMatch && req.method === 'POST') {
        const pageId = pageBlocksMatch[1];
        const bodyRaw = await readBody(req);
        let body = {};
        try { body = JSON.parse(bodyRaw || '{}'); } catch {}
        const { type, parentId = null, sort = 0, props = {}, content = {} } = body;
        if (!type) return sendJson(res, 400, { error: 'type required' });
        const block = dbCreateBlock(db, { pageId, parentId, sort: Number(sort) || 0, type: String(type), props, content });
        sendJson(res, 201, block);
        return;
      }

      // Patch block
      const blockMatch = pathname.match(/^\/api\/blocks\/([^\/]+)$/);
      if (blockMatch && req.method === 'PATCH') {
        const blockId = blockMatch[1];
        const bodyRaw = await readBody(req);
        let patch = {};
        try { patch = JSON.parse(bodyRaw || '{}'); } catch {}
        const updated = dbPatchBlock(db, blockId, patch || {});
        if (!updated) { sendJson(res, 404, { error: 'not found' }); return; }
        sendJson(res, 200, updated);
        return;
      }
      if (blockMatch && req.method === 'DELETE') {
        const blockId = blockMatch[1];
        const ok = dbDeleteBlock(db, blockId);
        if (!ok) { sendJson(res, 404, { error: 'not found' }); return; }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === '/api/blocks/reorder' && req.method === 'POST') {
        const bodyRaw = await readBody(req);
        let reqBody = {};
        try { reqBody = JSON.parse(bodyRaw || '{}'); } catch {}
        const pageId = reqBody.pageId;
        const moves = Array.isArray(reqBody.moves) ? reqBody.moves.map(m => ({ id: m.id, parentId: m.parentId ?? null, sort: Number(m.sort) || 0 })) : [];
        if (!pageId) return sendJson(res, 400, { error: 'pageId required' });
        const out = dbReorderBlocks(db, pageId, moves);
        sendJson(res, 200, out);
        return;
      }

      // User UI state persistence
      if (pathname === '/api/user/state' && req.method === 'GET') {
        const state = readJson(path.join(USER_DIR, 'state.json'), defaultUserState());
        sendJson(res, 200, state ?? defaultUserState());
        return;
      }

      if (pathname === '/api/user/state' && req.method === 'PUT') {
        const patchRaw = await readBody(req);
        let patch = {};
        try { patch = JSON.parse(patchRaw || '{}'); } catch {}
        const current = readJson(path.join(USER_DIR, 'state.json'), defaultUserState()) || defaultUserState();
        const next = { ...current, ...patch };
        writeJsonAtomic(path.join(USER_DIR, 'state.json'), next);
        sendJson(res, 200, next);
        return;
      }

      sendJson(res, 404, { error: 'unknown api route' });
      return;
    }

    // --- User data files (for per-user overrides like /user/custom.css) ---
    if (pathname === '/user/custom.css' && req.method === 'GET') {
      const p = path.join(USER_DIR, 'custom.css');
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        return fs.createReadStream(p).pipe(res);
      }
      return sendText(res, 200, '/* user css */', { 'Content-Type': 'text/css; charset=utf-8' });
    }
    if (pathname.startsWith('/user/')) {
      const fsPath = safeJoin(USER_DIR, pathname.replace('/user/', ''));
      if (!fsPath) return sendText(res, 400, 'bad path');
      if (!fs.existsSync(fsPath) || fs.statSync(fsPath).isDirectory()) {
        return sendText(res, 404, 'not found');
      }
      res.writeHead(200, { 'Content-Type': contentTypeFor(fsPath) });
      return fs.createReadStream(fsPath).pipe(res);
    }

    // --- Static assets ---
    // Map URL -> file in STATIC_DIR
    const staticPath = pathname === '/' ? '/index.html' : pathname;
    const fsPath = safeJoin(STATIC_DIR, staticPath);
    if (fsPath && fs.existsSync(fsPath) && fs.statSync(fsPath).isFile()) {
      res.writeHead(200, { 'Content-Type': contentTypeFor(fsPath) });
      return fs.createReadStream(fsPath).pipe(res);
    }

    // Decide if request looks like an asset (has a dot in the last path segment)
    const looksLikeAsset = path.basename(pathname).includes('.');

    // If it's an asset-like path and wasn't found, return 404 (do not SPA fallback)
    if (looksLikeAsset) {
      return sendText(res, 404, 'not found');
    }

    // --- SPA fallback (for route-like paths only) ---
    const indexPath = path.join(STATIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexPath).pipe(res);
    }

    return sendText(res, 404, 'not found');
  } catch (err) {
    console.error(err);
    return sendText(res, 500, 'internal error');
  }
});

server.listen(PORT, () => {
  console.log(`[dm-vault] running on http://localhost:${PORT}`);
  console.log(`[dm-vault] static: ${STATIC_DIR}`);
  console.log(`[dm-vault] data:   ${DATA_DIR}`);
});
