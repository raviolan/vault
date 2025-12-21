import { randomUUID } from 'node:crypto';

export function slugifyTitle(title) {
  let s = String(title || '');
  s = s.replaceAll('Å', 'A').replaceAll('Ä', 'A').replaceAll('Ö', 'O')
       .replaceAll('å', 'a').replaceAll('ä', 'a').replaceAll('ö', 'o');
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!s) s = 'page';
  return s;
}

export function ensureUniqueSlug(db, baseSlug) {
  let base = baseSlug || 'page';
  const exists = (x) => !!db.prepare('SELECT 1 FROM pages WHERE slug = ? LIMIT 1').get(x);
  if (!exists(base)) return base;
  let i = 2;
  while (i < 100000) {
    const cand = `${base}-${i}`;
    if (!exists(cand)) return cand;
    i++;
  }
  return `${base}-${randomUUID().slice(0,8)}`;
}

export function backfillSlugs(db) {
  const need = db.prepare('SELECT id, title FROM pages WHERE slug IS NULL OR slug = ""').all();
  if (!need.length) return;
  const upd = db.prepare('UPDATE pages SET slug = ?, updated_at = ? WHERE id = ?');
  const ts = Math.floor(Date.now() / 1000);
  const trx = db.transaction(() => {
    for (const r of need) {
      const unique = ensureUniqueSlug(db, slugifyTitle(r.title || ''));
      upd.run(unique, ts, r.id);
    }
  });
  trx();
}

