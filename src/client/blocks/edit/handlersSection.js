import { debouncePatch } from './state.js';
import { apiCreateBlock, apiPatchBlock, apiDeleteBlock, apiReorder } from './apiBridge.js';
import { getCurrentPageBlocks, setCurrentPageBlocks } from '../../lib/pageStore.js';
import { canUnwrapSectionTitle, opUnwrapSection } from './ops.js';

// Helper: insert a new empty paragraph as the FIRST child of a section.
// Ensures it is placed at sort 0 and normalizes all sibling sorts so it becomes first.
export async function insertFirstChildParagraph({ page, sectionId, focus, renderStable, rootEl }) {
  try {
    const blocks = getCurrentPageBlocks();
    const kids = blocks.filter(b => (b.parentId ?? null) === sectionId).sort((a,b) => a.sort - b.sort);
    const created = await apiCreateBlock(page.id, {
      type: 'paragraph',
      parentId: sectionId,
      sort: 0,
      props: {},
      content: { text: '' }
    });
    // Optimistically add created to the store
    setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
    // Build new order with created as the first child
    const newOrder = [created, ...kids];
    const moves = newOrder.map((n, i) => ({ id: n.id, parentId: sectionId, sort: i }));
    // Optimistic local update of parentId/sort for all affected nodes
    try {
      setCurrentPageBlocks(getCurrentPageBlocks().map(b => {
        const m = moves.find(mv => mv.id === b.id);
        return m ? { ...b, parentId: m.parentId, sort: m.sort } : b;
      }));
    } catch {}
    // Persist reordering (fire-and-forget)
    void apiReorder(page.id, moves).catch(() => {});
    // Re-render and focus the created paragraph
    const container = document.getElementById('pageBlocks') || rootEl;
    if (renderStable) renderStable(created.id);
    else if (container) {
      try { (await import('./render.js')).stableRender(container, page, getCurrentPageBlocks(), created.id); } catch {}
    }
    if (focus) try { focus(created.id); } catch {}
    return created;
  } catch (err) {
    console.error('insertFirstChildParagraph failed', err);
    throw err;
  }
}

export function bindSectionTitleHandlers({ page, block, inputEl, rootEl, renderStable, focus }) {
  inputEl.addEventListener('input', () => {
    const title = inputEl.value;
    debouncePatch(block.id, { content: { title } });
    // Show delete button only when title is empty (unwrap)
    try {
      const delBtn = rootEl?.querySelector?.('.section-delete-empty');
      if (delBtn) delBtn.hidden = String(title || '').trim() !== '';
    } catch {}
  });

  inputEl.addEventListener('keydown', async (e) => {
    const { apiCreateBlock } = await import('./apiBridge.js');
    const { getCurrentPageBlocks, setCurrentPageBlocks } = await import('../../lib/pageStore.js');
    const { indentBlock, outdentBlock, moveBlockWithinSiblings } = await import('./reorder.js');

    // Option/Alt+Enter — explicit sibling after this section (paragraph or new section with Shift)
    if ((e.key === 'Enter') && e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat) {
      e.preventDefault();
      const isSection = !!e.shiftKey;
      const payload = isSection
        ? { type: 'section', parentId: block.parentId ?? null, sort: Number(block.sort || 0) + 1, props: { collapsed: false }, content: { title: '' } }
        : { type: 'paragraph', parentId: block.parentId ?? null, sort: Number(block.sort || 0) + 1, props: {}, content: { text: '' } };
      try {
        const created = await apiCreateBlock(page.id, payload);
        setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
        const container = document.getElementById('pageBlocks');
        renderStable?.(created.id) || (container && (await import('./render.js')).stableRender(container, page, getCurrentPageBlocks(), created.id));
      } catch (err) { console.error('Failed to add sibling from section title', err); }
      return;
    }

    if (e.key === 'Enter' && !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) {
      e.preventDefault();
      await insertFirstChildParagraph({ page, sectionId: block.id, renderStable, focus, rootEl });
      return;
    }
    if (e.key === 'Tab' && !(e.ctrlKey || e.metaKey || e.altKey)) {
      e.preventDefault();
      if (e.shiftKey) await outdentBlock(page, block); else await indentBlock(page, block);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      await moveBlockWithinSiblings(page, block, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }

    // Option/Alt+Backspace/Delete — unwrap heading (keep content) when title is empty
    if ((e.key === 'Backspace' || e.key === 'Delete') && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const titleNow = inputEl.value || '';
      if (canUnwrapSectionTitle(titleNow)) {
        e.preventDefault();
        try {
          const { focusTargetId } = await opUnwrapSection({ pageId: page.id, sectionId: block.id });
          const container = document.getElementById('pageBlocks');
          if (renderStable) renderStable(focusTargetId || null);
          else if (container) (await import('./render.js')).stableRender(container, page, getCurrentPageBlocks(), focusTargetId || null);
          if (focusTargetId) focus(focusTargetId);
        } catch (err) { console.error('Failed to unwrap section via keyboard', err); }
        return;
      }
    }
  });

  // Initial visibility sync for delete-empty button
  try {
    const delBtn = rootEl?.querySelector?.('.section-delete-empty');
    if (delBtn) delBtn.hidden = String(inputEl.value || '').trim() !== '';
  } catch {}
}

export function bindSectionHeaderControls({ page, block, rootEl, titleInput, onAfterChange, focus }) {
  const header = rootEl.querySelector('.section-header');
  const toggle = header.querySelector('.section-toggle');
  const addBtn = header.querySelector('.section-add');
  const upBtn = header.querySelector('.section-move-up');
  const downBtn = header.querySelector('.section-move-down');
  const delBtn = header.querySelector('.section-delete-empty');

  toggle.addEventListener('click', async () => {
    const wasActive = document.activeElement && rootEl.contains(document.activeElement);
    try {
      const next = { ...(block.props || {}), collapsed: !block.props?.collapsed };
      await apiPatchBlock(block.id, { props: next });
      // Optimistically update local store
      try {
        setCurrentPageBlocks(getCurrentPageBlocks().map(b => b.id === block.id ? { ...b, propsJson: JSON.stringify(next) } : b));
      } catch {}
      await onAfterChange();
      if (wasActive) focus(block.id);
    } catch (e) { console.error('toggle failed', e); }
  });

  addBtn.addEventListener('click', async () => {
    try {
      const created = await insertFirstChildParagraph({ page, sectionId: block.id, focus, renderStable: null, rootEl });
      await onAfterChange();
      if (created?.id) focus(created.id);
    } catch (e) { console.error('add child failed', e); }
  });

  // Move up/down controls
  const attachMoveHandler = (btn, delta) => {
    if (!btn) return;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const { moveBlockWithinSiblings } = await import('./reorder.js');
        // Compute siblings; no-op if already at boundary
        const sibs = getCurrentPageBlocks().filter(x => (x.parentId || null) === (block.parentId ?? null)).sort((a,b) => a.sort - b.sort);
        const idx = sibs.findIndex(x => x.id === block.id);
        const targetIndex = idx + delta;
        if (idx < 0 || targetIndex < 0 || targetIndex >= sibs.length) return;
        await moveBlockWithinSiblings(page, block, delta);
        await onAfterChange();
        focus(block.id);
      } catch (err) { console.error('move section failed', err); }
    });
  };
  attachMoveHandler(upBtn, -1);
  attachMoveHandler(downBtn, 1);

  // Delete (unwrap) control — visible only when title is empty
  if (delBtn) {
    delBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const titleNow = (titleInput?.value || '');
        if (!canUnwrapSectionTitle(titleNow)) return;
        const { focusTargetId } = await opUnwrapSection({ pageId: page.id, sectionId: block.id });
        const container = document.getElementById('pageBlocks');
        if (container) {
          try {
            const { stableRender } = await import('./render.js');
            stableRender(container, page, getCurrentPageBlocks(), focusTargetId || null);
          } catch (err) { console.error('stable render after unwrap failed', err); }
        }
        if (focusTargetId) focus(focusTargetId);
      } catch (err) { console.error('unwrap section failed', err); }
    });
  }
}


export function bindSectionDrag({ page, block, wrapEl, headerEl, handleEl, onAfterChange, focus }) {
  if (!handleEl) return;
  let dragging = false;
  let pointerId = null;
  let indicator = null;
  let rafPending = false;
  let dropParentId = block.parentId ?? null; // dynamic during drag
  let dropIndex = null; // index within drop parent's children (sections only)
  let dropAsChild = false;
  let dropAsOutdent = false; // new: track explicit outdent intent

  const rootContainer = () => document.getElementById('pageBlocks') || wrapEl.parentElement;

  const parseProps = (b) => {
    try { return JSON.parse(b.propsJson || '{}') || {}; } catch { return {}; }
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const getDescendantIds = (id) => {
    const blocks = getCurrentPageBlocks();
    const byParent = new Map();
    for (const b of blocks) {
      const pid = b.parentId || null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(b);
    }
    const result = new Set();
    const q = (byParent.get(id) || []).slice();
    while (q.length) {
      const n = q.shift();
      result.add(n.id);
      const kids = byParent.get(n.id) || [];
      for (const k of kids) q.push(k);
    }
    return result;
  };

  const placeIndicator = () => {
    if (!indicator) return;
    const blocks = getCurrentPageBlocks();
    const containerEl = (() => {
      if (dropAsChild && dropParentId != null) {
        const parentWrap = document.querySelector(`[data-block-id="${dropParentId}"]`);
        return parentWrap?.querySelector?.('.section-children') || parentWrap || rootContainer();
      }
      // sibling case: use the parent container
      if (dropParentId == null) return rootContainer();
      const parentWrap = document.querySelector(`[data-block-id="${dropParentId}"]`);
      return parentWrap?.querySelector?.('.section-children') || rootContainer();
    })();
    if (!containerEl) return;

    const kids = blocks.filter(x => (x.parentId || null) === (dropParentId || null) && x.type === 'section')
      .sort((a,b) => a.sort - b.sort);
    const idx = dropIndex == null ? kids.length : Math.max(0, Math.min(kids.length, dropIndex));
    if (idx >= kids.length) {
      const last = kids[kids.length - 1];
      const lastEl = last ? document.querySelector(`[data-block-id="${last.id}"]`) : null;
      if (lastEl && lastEl.parentElement === containerEl) containerEl.insertBefore(indicator, lastEl.nextSibling);
      else containerEl.appendChild(indicator);
    } else {
      const targetEl = document.querySelector(`[data-block-id="${kids[idx].id}"]`);
      if (targetEl && targetEl.parentElement === containerEl) containerEl.insertBefore(indicator, targetEl);
    }
  };

  const computeDropTarget = (evt) => {
    const x = evt.clientX, y = evt.clientY;
    const el = document.elementFromPoint(x, y);
    const header = el?.closest?.('.section-header');
    if (!header) return null;
    const wrap = header.closest('.section-block');
    const idStr = wrap?.getAttribute?.('data-block-id');
    if (!idStr) return null;
    const targetId = isNaN(Number(idStr)) ? idStr : (Number(idStr));
    const blocks = getCurrentPageBlocks();
    const target = blocks.find(b => String(b.id) === String(targetId));
    if (!target) return null;
    const rect = header.getBoundingClientRect?.();
    const left = rect?.left || 0;
    const indentThreshold = left + 48;
    const outdentThreshold = left - 24;

    let asChild = false;
    let asOutdent = false;
    let parentId = null;

    if (x > indentThreshold) {
      // indent into target as a child
      asChild = true;
      parentId = target.id;
    } else if (x < outdentThreshold) {
      // outdent: become sibling after target's parent under its parent
      asOutdent = true;
      const targetParentId = target.parentId ?? null;
      if (targetParentId == null) {
        // Already root: behave like root-level sibling drop
        asOutdent = true;
        parentId = null;
      } else {
        const targetParent = blocks.find(b => String(b.id) === String(targetParentId));
        parentId = targetParent ? (targetParent.parentId ?? null) : null;
      }
    } else {
      // sibling within the same parent as target
      parentId = target.parentId ?? null;
    }

    // Prevent cycles
    const desc = getDescendantIds(block.id);
    if (desc.has(parentId)) return null;
    // Also prevent making a block the parent of itself
    if (String(parentId) === String(block.id)) return null;

    // Compute index among sections in that container based on y
    const siblings = blocks
      .filter(x => (x.parentId || null) === (parentId || null) && x.type === 'section')
      .sort((a,b) => a.sort - b.sort);

    let idx = siblings.length;
    if (asOutdent && (target.parentId ?? null) != null) {
      // Place after target's parent in the new parent's section list
      const parentIdx = siblings.findIndex(s => String(s.id) === String(target.parentId));
      idx = parentIdx >= 0 ? parentIdx + 1 : siblings.length;
    } else {
      for (let i = 0; i < siblings.length; i++) {
        const h = document.querySelector(`[data-block-id="${siblings[i].id}"] .section-header`);
        const r = h?.getBoundingClientRect?.();
        if (!r) continue;
        const mid = r.top + (r.height / 2);
        if (y < mid) { idx = i; break; }
      }
    }
    return { parentId, index: idx, asChild, asOutdent, target };
  };

  const onMove = (evt) => {
    if (!dragging) return;
    const tgt = computeDropTarget(evt);
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (!dragging) return;
        if (!tgt) return; // ignore out-of-target moves
        dropParentId = tgt.parentId ?? null;
        dropIndex = tgt.index;
        dropAsChild = !!tgt.asChild;
        dropAsOutdent = !!tgt.asOutdent;
        placeIndicator();
      });
    }
  };

  const onUp = async () => {
    if (!dragging) return;
    dragging = false;
    try { if (pointerId != null) handleEl.releasePointerCapture(pointerId); } catch {}
    pointerId = null;
    wrapEl.classList.remove('is-dragging');
    if (indicator && indicator.parentElement) indicator.parentElement.removeChild(indicator);
    indicator = null;

    // If no computed drop, do nothing
    if (dropIndex == null) return;

    try {
      const blocks = getCurrentPageBlocks();
      const cur = blocks.find(b => String(b.id) === String(block.id));
      if (!cur) return;
      const oldParentId = cur.parentId ?? null;
      const newParentId = dropParentId ?? null;

      // Build old full sibling list (ALL types) under old parent
      const oldFull = blocks
        .filter(x => (x.parentId || null) === (oldParentId || null))
        .sort((a,b) => a.sort - b.sort);
      const startIdx = oldFull.findIndex(x => String(x.id) === String(cur.id));
      if (startIdx < 0) return;
      const chunk = [];
      for (let i = startIdx; i < oldFull.length; i++) {
        const it = oldFull[i];
        if (i > startIdx && it.type === 'section') break;
        chunk.push(it);
      }
      const oldRemaining = oldFull.slice(0, startIdx).concat(oldFull.slice(startIdx + chunk.length));

      // Build new base list for new parent (ALL types)
      let newFullBase;
      if ((newParentId || null) === (oldParentId || null)) {
        newFullBase = oldRemaining.slice();
      } else {
        newFullBase = blocks
          .filter(x => (x.parentId || null) === (newParentId || null))
          .sort((a,b) => a.sort - b.sort);
      }

      // Convert section-index dropIndex to full-list index
      const sectionSibs = newFullBase.filter(b => b.type === 'section');
      let insertAtFull;
      if (dropIndex >= sectionSibs.length) {
        insertAtFull = newFullBase.length;
      } else {
        const refSectionId = sectionSibs[Math.max(0, dropIndex)].id;
        insertAtFull = newFullBase.findIndex(b => String(b.id) === String(refSectionId));
        if (insertAtFull < 0) insertAtFull = newFullBase.length;
      }

      const newFull = newFullBase.slice();
      newFull.splice(insertAtFull, 0, ...chunk);

      const moves = [];
      // Moves for new parent container (now including chunk)
      newFull.forEach((n, i) => moves.push({ id: n.id, parentId: newParentId, sort: i }));
      // Re-pack old parent container if different
      if ((newParentId || null) !== (oldParentId || null)) {
        oldRemaining.forEach((n, i) => moves.push({ id: n.id, parentId: oldParentId, sort: i }));
      }

      // Optimistic local reorder
      try {
        const byId = new Map(getCurrentPageBlocks().map(x => [x.id, { ...x }]));
        for (const m of moves) {
          const n = byId.get(m.id);
          if (!n) continue;
          n.parentId = m.parentId ?? null;
          n.sort = m.sort;
        }
        setCurrentPageBlocks(Array.from(byId.values()).slice().sort((a,b) => ((a.parentId||'') === (b.parentId||'')) ? (a.sort - b.sort) : (String(a.parentId||'').localeCompare(String(b.parentId||'')) || (a.sort - b.sort))));
      } catch {}
      void apiReorder(page.id, moves).catch(() => {});

      // Update level based on structural change
      try {
        let newLevel = 1;
        if (dropAsChild) {
          const tProps = parseProps(getCurrentPageBlocks().find(x => x.id === dropParentId) || {});
          const tLevel = Number(tProps.level || 1);
          newLevel = clamp(tLevel + 1, 1, 3);
        } else if (newParentId != null) {
          // sibling near target: use target's level
          // find any section under this parent at dropIndex (or nearest)
          const sibs = getCurrentPageBlocks().filter(x => (x.parentId || null) === newParentId && x.type === 'section').sort((a,b) => a.sort - b.sort);
          const ref = sibs[Math.min(Math.max(0, dropIndex || 0), Math.max(0, sibs.length - 1))];
          const refProps = parseProps(ref || {});
          newLevel = Number(refProps.level || 1);
        } else {
          newLevel = 1;
        }
        const curBlock = getCurrentPageBlocks().find(x => String(x.id) === String(block.id)) || block;
        const existingProps = parseProps(curBlock);
        const nextProps = { ...existingProps, level: newLevel };
        await apiPatchBlock(block.id, { props: nextProps });
        // update local
        setCurrentPageBlocks(getCurrentPageBlocks().map(b => b.id === block.id ? { ...b, propsJson: JSON.stringify(nextProps) } : b));
      } catch {}

      await onAfterChange();
      focus(block.id);
    } catch (err) {
      console.error('drag reorder failed', err);
    }
  };

  handleEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { handleEl.setPointerCapture(e.pointerId); pointerId = e.pointerId; } catch {}
    dragging = true;
    wrapEl.classList.add('is-dragging');
    // Default drop context is current parent at current index
    dropParentId = block.parentId ?? null;
    dropIndex = null;
    dropAsChild = false;
    dropAsOutdent = false;
    indicator = document.createElement('div');
    indicator.className = 'drag-indicator';
    // Bind listeners
    const move = (evt) => onMove(evt);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onUp();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}
