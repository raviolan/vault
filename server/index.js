// Composition root for the server runtime.
// Module layout:
// - server/lib/http.js     (sendJson, readBody/buffer, JSON helpers)
// - server/lib/paths.js    (data/static root resolution)
// - server/lib/static.js   (static assets + SPA fallback, content types)
// - server/routes/*        (all API + user state routes)
// - server/db/*            (DB open/migrate + domain accessors)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolveStaticDir, getDataRoot } from './lib/paths.js';
import { serveStaticOrSpa } from './lib/static.js';
import { routeRequest } from './routes/index.js';
import { ensureUserDirs } from './routes/userState.js';
import { sendText } from './lib/http.js';
import { openDb, migrate, backfillSlugs, listPages as dbListPages, searchPages as dbSearchPages, getBacklinks as dbGetBacklinks, createPage as dbCreatePage, getPageWithBlocks as dbGetPageWithBlocks, getPageWithBlocksBySlug as dbGetPageWithBlocksBySlug, patchPage as dbPatchPage, deletePage as dbDeletePage, createBlock as dbCreateBlock, patchBlock as dbPatchBlock, deleteBlock as dbDeleteBlock, reorderBlocks as dbReorderBlocks, ensureTag as dbEnsureTag, listTagsWithCounts as dbListTagsWithCounts, getPageTags as dbGetPageTags, setPageTags as dbSetPageTags, getPageSnapshots as dbGetPageSnapshots, setPageMedia as dbSetPageMedia, clearPageMediaSlot as dbClearPageMediaSlot } from './db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);

const STATIC_DIR = resolveStaticDir();
const DATA_DIR = getDataRoot();
const DB_FILE_PATH = path.join(DATA_DIR, 'vault', 'vault.sqlite');
const USER_DIR = path.join(DATA_DIR, 'user');

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

// Ensure user dir and default state
ensureUserDirs({ USER_DIR });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const ctx = {
      db,
      reloadDb,
      DATA_DIR,
      USER_DIR,
      STATIC_DIR,
      DB_FILE_PATH,
      dbListPages,
      dbSearchPages,
      dbGetBacklinks,
      dbCreatePage,
      dbGetPageWithBlocks,
      dbGetPageWithBlocksBySlug,
      dbPatchPage,
      dbDeletePage,
      dbCreateBlock,
      dbPatchBlock,
      dbDeleteBlock,
      dbReorderBlocks,
      dbEnsureTag,
      dbListTagsWithCounts,
      dbGetPageTags,
      dbSetPageTags,
      dbGetPageSnapshots,
      dbSetPageMedia,
      dbClearPageMediaSlot,
    };

    // Optional minimal request logging for /api/* endpoints
    const LOG_REQUESTS = process.env.DMV_LOG_REQUESTS === '1' || process.env.DMV_LOG_REQUESTS === 'true';
    const start = Date.now();
    const shouldLog = LOG_REQUESTS && pathname.startsWith('/api/');
    if (shouldLog) {
      res.once('finish', () => {
        try {
          const dur = Date.now() - start;
          // Single-line log: method, path, statusCode, durationMs
          console.log(`[api] ${req.method} ${pathname} ${res.statusCode} ${dur}ms`);
        } catch {}
      });
    }

    const handled = await routeRequest(req, res, ctx);
    if (handled) return;

    // Static and SPA fallback if not handled by routes
    const served = serveStaticOrSpa(req, res, ctx);
    if (served) return;

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
