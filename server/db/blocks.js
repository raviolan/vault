import { randomUUID } from 'node:crypto';

function nowTs() { return Math.floor(Date.now() / 1000); }

export function touchPage(db, pageId) {
  const ts = nowTs();
  db.prepare('UPDATE pages SET updated_at = ? WHERE id = ?').run(ts, pageId);
}

export function normalizeSiblingSort(db, pageId, parentId) {
  const trx = db.transaction(() => {
    const rows = db.prepare('SELECT id FROM blocks WHERE page_id = ? AND parent_id IS ? ORDER BY sort, created_at, id').all(pageId, parentId);
    const upd = db.prepare('UPDATE blocks SET sort = ? WHERE id = ?');
    let i = 0;
    for (const r of rows) {
      upd.run(i++, r.id);
    }
    touchPage(db, pageId);
  });
  trx();
}

export function createBlock(db, { pageId, parentId = null, sort = 0, type, props = {}, content = {} }) {
  const id = randomUUID();
  const ts = nowTs();
  const insert = db.prepare('INSERT INTO blocks(id, page_id, parent_id, sort, type, props_json, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const trx = db.transaction(() => {
    insert.run(id, pageId, parentId, sort, String(type), JSON.stringify(props || {}), JSON.stringify(content || {}), ts, ts);
    normalizeSiblingSort(db, pageId, parentId ?? null);
    touchPage(db, pageId);
  });
  trx();
  const row = db.prepare('SELECT id, page_id, parent_id, sort, type, props_json, content_json, created_at, updated_at FROM blocks WHERE id = ?').get(id);
  return {
    id: row.id,
    pageId: row.page_id,
    parentId: row.parent_id,
    sort: row.sort,
    type: row.type,
    propsJson: row.props_json,
    contentJson: row.content_json,
    createdAt: new Date(row.created_at * 1000).toISOString(),
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
  };
}

export function patchBlock(db, blockId, patch) {
  const cur = db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId);
  if (!cur) return null;
  const next = {
    page_id: cur.page_id,
    parent_id: (patch.parentId === undefined ? cur.parent_id : patch.parentId),
    sort: (patch.sort === undefined ? cur.sort : patch.sort),
    type: (patch.type === undefined ? cur.type : String(patch.type)),
    props_json: (patch.props === undefined ? cur.props_json : JSON.stringify(patch.props || {})),
    content_json: (patch.content === undefined ? cur.content_json : JSON.stringify(patch.content || {})),
    updated_at: nowTs(),
  };
  const trx = db.transaction(() => {
    db.prepare('UPDATE blocks SET parent_id = ?, sort = ?, type = ?, props_json = ?, content_json = ?, updated_at = ? WHERE id = ?')
      .run(next.parent_id ?? null, next.sort, next.type, next.props_json, next.content_json, next.updated_at, blockId);
    normalizeSiblingSort(db, cur.page_id, next.parent_id ?? null);
    touchPage(db, cur.page_id);
  });
  trx();
  const row = db.prepare('SELECT id, page_id, parent_id, sort, type, props_json, content_json, created_at, updated_at FROM blocks WHERE id = ?').get(blockId);
  return {
    id: row.id,
    pageId: row.page_id,
    parentId: row.parent_id,
    sort: row.sort,
    type: row.type,
    propsJson: row.props_json,
    contentJson: row.content_json,
    createdAt: new Date(row.created_at * 1000).toISOString(),
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
  };
}

export function deleteBlock(db, blockId) {
  const cur = db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId);
  if (!cur) return false;
  const trx = db.transaction(() => {
    db.prepare('DELETE FROM blocks WHERE id = ?').run(blockId);
    normalizeSiblingSort(db, cur.page_id, cur.parent_id ?? null);
    touchPage(db, cur.page_id);
  });
  trx();
  return true;
}

export function reorderBlocks(db, pageId, moves) {
  if (!Array.isArray(moves) || !moves.length) return { ok: true };
  const update = db.prepare('UPDATE blocks SET parent_id = ?, sort = ?, updated_at = ? WHERE id = ? AND page_id = ?');
  const ts = nowTs();
  const parentsTouched = new Set();
  const trx = db.transaction(() => {
    for (const m of moves) {
      update.run(m.parentId ?? null, m.sort, ts, m.id, pageId);
      parentsTouched.add(m.parentId ?? null);
    }
    for (const pid of parentsTouched) {
      normalizeSiblingSort(db, pageId, pid);
    }
    touchPage(db, pageId);
  });
  trx();
  return { ok: true };
}

