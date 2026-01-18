import fs from 'node:fs';
import path from 'node:path';
import { sendText } from './http.js';

export function contentTypeFor(filePath) {
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

export function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const resolved = path.normalize(path.join(root, decoded));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

// Serve static files from STATIC_DIR and /user from USER_DIR, SPA fallback rules preserved
export function serveStaticOrSpa(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // /user/* generic static (except /user/custom.css which a route may handle earlier)
  if (pathname.startsWith('/user/')) {
    const fsPath = safeJoin(ctx.USER_DIR, pathname.replace('/user/', ''));
    if (!fsPath) return sendText(res, 400, 'bad path'), true;
    if (!fs.existsSync(fsPath) || fs.statSync(fsPath).isDirectory()) {
      return sendText(res, 404, 'not found'), true;
    }
    res.writeHead(200, { 'Content-Type': contentTypeFor(fsPath) });
    fs.createReadStream(fsPath).pipe(res);
    return true;
  }

  // Static assets from build/public
  const staticPath = pathname === '/' ? '/index.html' : pathname;
  const fsPath = safeJoin(ctx.STATIC_DIR, staticPath);
  if (fsPath && fs.existsSync(fsPath) && fs.statSync(fsPath).isFile()) {
    res.writeHead(200, { 'Content-Type': contentTypeFor(fsPath) });
    fs.createReadStream(fsPath).pipe(res);
    return true;
  }

  // If request looks like an asset (has a dot), do not SPA-fallback — return 404
  const looksLikeAsset = path.basename(pathname).includes('.');
  if (looksLikeAsset) {
    sendText(res, 404, 'not found');
    return true;
  }

  // SPA fallback to index.html when present
  const indexPath = path.join(ctx.STATIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(indexPath).pipe(res);
    return true;
  }

  // Nothing matched
  return false;
}

