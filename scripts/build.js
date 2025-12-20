import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const PUBLIC = path.join(ROOT, 'public');
const INDEX = path.join(ROOT, 'src/client/index.html');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

rmrf(DIST);
fs.mkdirSync(DIST, { recursive: true });

// Copy static assets
copyDir(PUBLIC, DIST);
fs.copyFileSync(INDEX, path.join(DIST, 'index.html'));

await build({
  entryPoints: [path.join(ROOT, 'src/client/app.js')],
  outdir: DIST,
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  splitting: true,
  sourcemap: true,
  minify: false,
  platform: 'browser',
});

console.log('Built to dist/');
