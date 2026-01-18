import { getCurrentPageBlocks, setCurrentPageBlocks } from '../../lib/pageStore.js';
import { apiReorder } from './apiBridge.js';

function orderedBlocksFlat() {
  const arr = getCurrentPageBlocks().slice();
  return arr.sort((a,b) => ((a.parentId||'') === (b.parentId||'')) ? (a.sort - b.sort) : (String(a.parentId||'').localeCompare(String(b.parentId||'')) || (a.sort - b.sort)));
}

function siblingsOf(parentId) {
  return getCurrentPageBlocks().filter(x => (x.parentId || null) === (parentId || null)).slice().sort((a,b) => a.sort - b.sort);
}

export async function indentBlock(page, b) {
  const flat = orderedBlocksFlat();
  const idx = flat.findIndex(x => x.id === b.id);
  if (idx <= 0) return { focusId: b.id };
  const prev = flat[idx - 1];
  if (!prev) return { focusId: b.id };
  const oldParentId = b.parentId ?? null;
  const newParentId = prev.id;
  const newChildren = siblingsOf(newParentId).filter(x => x.id !== b.id);
  newChildren.push(b);
  const moves = [];
  newChildren.forEach((child, i) => moves.push({ id: child.id, parentId: newParentId, sort: i }));
  const oldSibs = siblingsOf(oldParentId).filter(x => x.id !== b.id);
  oldSibs.forEach((sib, i) => moves.push({ id: sib.id, parentId: oldParentId, sort: i }));
  // Optimistically update local store for immediate feedback
  try {
    const byId = new Map(getCurrentPageBlocks().map(x => [x.id, { ...x }]));
    for (const m of moves) {
      const n = byId.get(m.id);
      if (!n) continue;
      n.parentId = m.parentId ?? null;
      n.sort = m.sort;
    }
    const next = Array.from(byId.values()).slice().sort((a,b) => ((a.parentId||'') === (b.parentId||'')) ? (a.sort - b.sort) : (String(a.parentId||'').localeCompare(String(b.parentId||'')) || (a.sort - b.sort)));
    setCurrentPageBlocks(next);
  } catch {}
  // Fire-and-forget server reorder; do not block UI
  void apiReorder(page.id, moves).catch(() => {});
  return { focusId: b.id };
}

export async function outdentBlock(page, b) {
  const parent = getCurrentPageBlocks().find(x => x.id === (b.parentId || ''));
  if (!parent) return { focusId: b.id };
  const grandParentId = parent.parentId ?? null;

  const grandSibs = siblingsOf(grandParentId);
  const parentIndex = grandSibs.findIndex(x => x.id === parent.id);
  const before = grandSibs.slice(0, parentIndex + 1);
  const after = grandSibs.slice(parentIndex + 1).filter(x => x.id !== b.id);
  const newOrder = before.concat([b], after);

  const moves = [];
  newOrder.forEach((node, i) => moves.push({ id: node.id, parentId: grandParentId, sort: i }));
  const oldChildren = siblingsOf(parent.id).filter(x => x.id !== b.id);
  oldChildren.forEach((node, i) => moves.push({ id: node.id, parentId: parent.id, sort: i }));

  // Optimistically update local order
  try {
    const byId = new Map(getCurrentPageBlocks().map(x => [x.id, { ...x }]));
    for (const m of moves) {
      const n = byId.get(m.id);
      if (!n) continue;
      n.parentId = m.parentId ?? null;
      n.sort = m.sort;
    }
    const next = Array.from(byId.values()).slice().sort((a,b) => ((a.parentId||'') === (b.parentId||'')) ? (a.sort - b.sort) : (String(a.parentId||'').localeCompare(String(b.parentId||'')) || (a.sort - b.sort)));
    setCurrentPageBlocks(next);
  } catch {}
  void apiReorder(page.id, moves).catch(() => {});
  return { focusId: b.id };
}

export async function moveBlockWithinSiblings(page, b, delta) {
  const group = siblingsOf(b.parentId ?? null);
  const i = group.findIndex(x => x.id === b.id);
  if (i < 0) return { focusId: b.id };
  const j = i + delta;
  if (j < 0 || j >= group.length) return { focusId: b.id };
  const swapped = group.slice();
  const tmp = swapped[i];
  swapped[i] = swapped[j];
  swapped[j] = tmp;
  const moves = swapped.map((node, idx) => ({ id: node.id, parentId: b.parentId ?? null, sort: idx }));
  // Optimistically update local order
  try {
    const byId = new Map(getCurrentPageBlocks().map(x => [x.id, { ...x }]));
    for (const m of moves) {
      const n = byId.get(m.id);
      if (!n) continue;
      n.parentId = m.parentId ?? null;
      n.sort = m.sort;
    }
    const next = Array.from(byId.values()).slice().sort((a,b) => ((a.parentId||'') === (b.parentId||'')) ? (a.sort - b.sort) : (String(a.parentId||'').localeCompare(String(b.parentId||'')) || (a.sort - b.sort)));
    setCurrentPageBlocks(next);
  } catch {}
  void apiReorder(page.id, moves).catch(() => {});
  return { focusId: b.id };
}
