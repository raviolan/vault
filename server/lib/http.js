import fs from 'node:fs';

export async function readBody(req, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > maxBytes) {
        reject(new Error('payload too large'));
        try { req.destroy(); } catch {}
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export async function readBuffer(req, maxBytes = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = Object.assign(new Error('payload too large'), { status: 413 });
        reject(err);
        try { req.destroy(); } catch {}
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

export function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(text);
}

export function parseJsonSafe(text, fallback = {}) {
  try { return JSON.parse(text || ''); } catch { return fallback; }
}

export function writeJsonAtomic(p, obj) {
  const dir = p.substring(0, p.lastIndexOf('/'));
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

