import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, listPages as dbListPages, createPage as dbCreatePage, getPageWithBlocks as dbGetPageWithBlocks, deletePage as dbDeletePage } from './db.js';
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
const db = openDb();
migrate(db);
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
        return sendJson(res, 200, dbListPages(db));
      }

      if (pathname === '/api/pages' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        if (!body.title) return sendJson(res, 400, { error: 'title required' });
        const page = dbCreatePage(db, { title: String(body.title), type: String(body.type || 'note') });
        return sendJson(res, 201, page);
      }

      const pageIdMatch = pathname.match(/^\/api\/pages\/([^\/]+)$/);
      if (pageIdMatch) {
        const id = pageIdMatch[1];

        if (req.method === 'GET') {
          const page = dbGetPageWithBlocks(db, id);
          if (!page) return sendJson(res, 404, { error: 'not found' });
          return sendJson(res, 200, page);
        }

        if (req.method === 'DELETE') {
          dbDeletePage(db, id);
          return sendJson(res, 200, { ok: true });
        }
      }

      // User UI state persistence
      if (pathname === '/api/user/state' && req.method === 'GET') {
        const state = readJson(path.join(USER_DIR, 'state.json'), defaultUserState());
        return sendJson(res, 200, state ?? defaultUserState());
      }

      if (pathname === '/api/user/state' && req.method === 'PUT') {
        const patchRaw = await readBody(req);
        let patch = {};
        try { patch = JSON.parse(patchRaw || '{}'); } catch {}
        const current = readJson(path.join(USER_DIR, 'state.json'), defaultUserState()) || defaultUserState();
        const next = { ...current, ...patch };
        writeJsonAtomic(path.join(USER_DIR, 'state.json'), next);
        return sendJson(res, 200, next);
      }

      return sendJson(res, 404, { error: 'unknown api route' });
    }

    // --- User data files (for per-user overrides like /user/custom.css) ---
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

    // --- SPA fallback ---
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
