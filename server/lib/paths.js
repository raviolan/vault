import fs from 'node:fs';
import path from 'node:path';

export function resolveStaticDir() {
  const dist = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) return dist;
  return path.resolve(process.cwd(), 'public');
}

// Canonical data root: prefer $DATA_DIR, else /data if present, else ./data
export function getDataRoot() {
  const env = process.env.DATA_DIR;
  if (env) return path.resolve(env);
  const dockerPath = '/data';
  try { if (fs.existsSync(dockerPath)) return dockerPath; } catch {}
  return path.resolve(process.cwd(), 'data');
}

