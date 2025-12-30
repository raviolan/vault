import { apiReorder, apiDeleteBlock } from './apiBridge.js';
import { getCurrentPageBlocks, setCurrentPageBlocks } from '../../lib/pageStore.js';
import { normalizeParentId, getChildren, getSiblings } from './blockAccess.js';

export function canUnwrapSectionTitle(title) {
  return String(title || '').trim() === '';
}

export async function opUnwrapSection({ pageId, sectionId }) {
  const all = getCurrentPageBlocks();
  // Snapshot essentials
  const section = all.find((b) => String(b.id) === String(sectionId));
  if (!section || section.type !== 'section') return { focusTargetId: sectionId };

  const parentId = normalizeParentId(section.parentId);
  const siblings = getSiblings(all, parentId); // parsed + sorted
  const children = getChildren(all, sectionId); // parsed + sorted
  const idx = Math.max(
    0,
    (() => {
      const i = siblings.findIndex((b) => String(b.id) === String(sectionId));
      return i >= 0 ? i : siblings.length;
    })()
  );

  // Build new order: siblings without section, with children inserted at idx
  const sibsExcluding = siblings.filter((b) => String(b.id) !== String(sectionId));
  const newOrder = sibsExcluding.slice();
  if (children.length) newOrder.splice(idx, 0, ...children);

  const moves = newOrder.map((b, i) => ({ id: b.id, parentId, sort: i }));

  // Optimistic local update for moves (but do not remove section yet)
  try {
    const byId = new Map(all.map((x) => [x.id, { ...x }]));
    for (const m of moves) {
      const n = byId.get(m.id);
      if (!n) continue;
      n.parentId = normalizeParentId(m.parentId);
      n.sort = m.sort;
    }
    setCurrentPageBlocks(Array.from(byId.values()));
  } catch {}

  await apiReorder(pageId, moves);
  await apiDeleteBlock(sectionId);

  // Remove section from local store after delete succeeds
  try {
    setCurrentPageBlocks(getCurrentPageBlocks().filter((b) => String(b.id) !== String(sectionId)));
  } catch {}

  // Determine focus target
  const focusTargetId = (() => {
    if (children.length) return children[0].id;
    const prev = sibsExcluding[idx - 1];
    if (prev) return prev.id;
    const next = sibsExcluding[idx];
    if (next) return next.id;
    return parentId || null;
  })();

  return { focusTargetId };
}

