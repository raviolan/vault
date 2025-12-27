import { getCurrentPageBlocks, setCurrentPageBlocks } from '../../lib/pageStore.js';
import { apiReorder, refreshBlocksFromServer, apiPatchBlock } from './apiBridge.js';
import { parseMaybeJson } from '../tree.js';

function clampLevel(n) { n = Number(n||0); if (n < 1 || n > 3) return 0; return n; }

// Build a quick lookup of parsed blocks
function getParsedBlocks() {
  return getCurrentPageBlocks().map(b => ({
    ...b,
    props: parseMaybeJson(b.propsJson || b.props),
    content: parseMaybeJson(b.contentJson || b.content),
  }));
}

export async function normalizeOutlineFromLevels(page, { scopeParentId = null } = {}) {
  const all = getParsedBlocks();
  const parentKey = (v) => (v ?? null);
  const inScope = all.filter(b => parentKey(b.parentId) === parentKey(scopeParentId)).slice().sort((a,b) => (a.sort||0) - (b.sort||0));

  if (!inScope.length) return;

  // Optional: migrate legacy heading blocks at the root into sections for smoother UX
  for (const b of inScope) {
    if (b.type === 'heading') {
      const lvl = clampLevel(b.props?.level);
      try {
        await apiPatchBlock(b.id, { type: 'section', props: { ...(b.props||{}), collapsed: false, level: lvl || 1 }, content: { title: String(b.content?.text || '') } });
      } catch {}
    }
  }
  // Refresh local snapshot after possible conversions
  await refreshBlocksFromServer(page.id);
  const scope = getParsedBlocks().filter(b => parentKey(b.parentId) === parentKey(scopeParentId)).slice().sort((a,b) => (a.sort||0) - (b.sort||0));

  // Walk and compute desired parentId for each node
  const lastByLevel = { 1: null, 2: null, 3: null };
  let currentContainer = null; // current heading section id
  const desired = new Map(); // id -> { parentId }

  for (const b of scope) {
    const level = clampLevel(b.props?.level);
    if (b.type === 'section' && level) {
      // Determine desired parent by level
      let desiredParentId = null;
      if (level === 1) desiredParentId = null;
      else if (level === 2) desiredParentId = lastByLevel[1] || null;
      else if (level === 3) desiredParentId = lastByLevel[2] || lastByLevel[1] || null;

      // Update stack
      lastByLevel[level] = b.id;
      if (level < 3) lastByLevel[3] = null;
      if (level < 2) lastByLevel[2] = null;
      currentContainer = b.id;
      desired.set(b.id, { parentId: desiredParentId });
    } else if (b.type === 'section' && !level) {
      // Plain section: reset current container; don't pull content under previous heading
      currentContainer = null;
      lastByLevel[1] = lastByLevel[1]; // no-op; preserve stack of higher levels if needed
      desired.set(b.id, { parentId: scopeParentId });
    } else {
      // Paragraph, divider, etc — roll under current heading if present
      const desiredParentId = currentContainer || null;
      desired.set(b.id, { parentId: desiredParentId });
    }
  }

  // Build per-parent buckets and compute new sorts
  const buckets = new Map(); // parentId(string|null) -> [ids]
  function keyOf(v) { return v == null ? 'null' : String(v); }

  // Initialize buckets with resulting parents so we can order by original order
  for (const b of scope) {
    const d = desired.get(b.id) || { parentId: b.parentId ?? null };
    const k = keyOf(d.parentId);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(b.id);
  }

  // Compute moves comparing desired parents and assigning incremental sorts per group
  const moves = [];
  for (const [k, ids] of buckets.entries()) {
    const parentId = (k === 'null') ? null : k;
    ids.forEach((id, index) => {
      const d = desired.get(id) || { parentId };
      moves.push({ id, parentId: d.parentId, sort: index });
    });
  }

  if (moves.length) {
    await apiReorder(page.id, moves);
    await refreshBlocksFromServer(page.id);
  }
}

