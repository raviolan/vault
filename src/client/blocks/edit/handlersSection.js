import { debouncePatch } from './state.js';
import { apiCreateBlock, apiPatchBlock, apiDeleteBlock, apiReorder } from './apiBridge.js';
import { getCurrentPageBlocks, setCurrentPageBlocks } from '../../lib/pageStore.js';

export function bindSectionTitleHandlers({ page, block, inputEl, rootEl, renderStable, focus }) {
  inputEl.addEventListener('input', () => {
    const title = inputEl.value;
    debouncePatch(block.id, { content: { ...(block.content || {}), title } });
    // Keep delete-empty button visibility synced
    try {
      const { canDelete } = isEffectivelyEmptySection(block, title);
      const delBtn = rootEl?.querySelector?.('.section-delete-empty');
      if (delBtn) delBtn.hidden = !canDelete;
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
      const kids = getCurrentPageBlocks().filter(x => (x.parentId || null) === block.id).sort((a, c) => a.sort - c.sort);
      const nextSort = kids.length ? (kids[kids.length - 1].sort + 1) : 0;
      const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: block.id, sort: nextSort, props: {}, content: { text: '' } });
      setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
      const container = document.getElementById('pageBlocks');
      renderStable?.(created.id) || (container && (await import('./render.js')).stableRender(container, page, getCurrentPageBlocks(), created.id));
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

    // Delete empty section via Backspace/Delete when safe (handles empty child paragraphs)
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const titleNow = inputEl.value;
      const { canDelete, emptyParagraphIds } = isEffectivelyEmptySection(block, titleNow);
      if (canDelete) {
        e.preventDefault();
        try {
          const focusTargetId = findSectionFocusTarget(block);
          for (const pid of emptyParagraphIds) {
            await apiDeleteBlock(pid);
          }
          await apiDeleteBlock(block.id);
          const container = document.getElementById('pageBlocks');
          if (renderStable) renderStable(focusTargetId || null);
          else if (container) (await import('./render.js')).stableRender(container, page, getCurrentPageBlocks(), focusTargetId || null);
        } catch (err) { console.error('Failed to delete empty section via keyboard', err); }
        return;
      }
    }
  });

  // Initial visibility sync for delete-empty button
  try {
    const { canDelete } = isEffectivelyEmptySection(block, (inputEl.value || ''));
    const delBtn = rootEl?.querySelector?.('.section-delete-empty');
    if (delBtn) delBtn.hidden = !canDelete;
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
      const kids = getCurrentPageBlocks().filter(x => (x.parentId || null) === block.id).sort((a, c) => a.sort - c.sort);
      const nextSort = kids.length ? (kids[kids.length - 1].sort + 1) : 0;
      const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: block.id, sort: nextSort, props: {}, content: { text: '' } });
      setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
      await onAfterChange();
      focus(created.id);
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

  // Delete-empty control (shown only when safe)
  if (delBtn) {
    delBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const titleNow = (titleInput?.value || '').trim();
        const { canDelete, emptyParagraphIds } = isEffectivelyEmptySection(block, titleNow);
        if (!canDelete) return;

        const focusTargetId = findSectionFocusTarget(block);

        // delete empties first, then section
        for (const pid of emptyParagraphIds) {
          await apiDeleteBlock(pid);
        }
        await apiDeleteBlock(block.id);
        const container = document.getElementById('pageBlocks');
        if (container) {
          try {
            const { stableRender } = await import('./render.js');
            stableRender(container, page, getCurrentPageBlocks(), focusTargetId || null);
          } catch (err) { console.error('stable render after delete failed', err); }
        }
        if (focusTargetId) focus(focusTargetId);
      } catch (err) { console.error('delete empty section failed', err); }
    });
  }
}

// Helper: determine if a section is effectively empty (aside from title) and collect deletable empty paragraphs
function isEffectivelyEmptySection(sectionBlock, titleNow) {
  const blocks = getCurrentPageBlocks();
  const titleEmpty = (titleNow ?? (sectionBlock?.content?.title || '')).trim() === '';
  if (!titleEmpty) return { canDelete: false, emptyParagraphIds: [] };
  // gather descendants
  const byParent = new Map();
  for (const b of blocks) {
    const pid = b.parentId || null;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(b);
  }
  const descendants = [];
  const queue = (byParent.get(sectionBlock.id) || []).slice();
  while (queue.length) {
    const n = queue.shift();
    descendants.push(n);
    const kids = byParent.get(n.id) || [];
    for (const k of kids) queue.push(k);
  }
  if (descendants.length === 0) return { canDelete: true, emptyParagraphIds: [] };
  const emptyParagraphIds = [];
  for (const d of descendants) {
    if (d.type !== 'paragraph') return { canDelete: false, emptyParagraphIds: [] };
    const txt = (d.content?.text || '').trim();
    if (txt !== '') return { canDelete: false, emptyParagraphIds: [] };
    emptyParagraphIds.push(d.id);
  }
  return { canDelete: true, emptyParagraphIds };
}

// Helper: choose a sensible section-focused target after deletion
function findSectionFocusTarget(block) {
  const blocks = getCurrentPageBlocks();
  const sibSections = blocks
    .filter(x => (x.parentId || null) === (block.parentId ?? null) && x.type === 'section')
    .sort((a,b) => a.sort - b.sort);
  const idx = sibSections.findIndex(x => x.id === block.id);
  const prev = (idx > 0) ? sibSections[idx - 1] : null;
  const next = (idx >= 0 && idx < sibSections.length - 1) ? sibSections[idx + 1] : null;
  return (prev?.id) || (next?.id) || (block.parentId || null) || null;
}

export function bindSectionDrag({ page, block, wrapEl, headerEl, handleEl, onAfterChange, focus }) {
  if (!handleEl) return;
  let dragging = false;
  let targetIndexSec = null;
  let originalIndexSec = null;
  let indicator = null;
  let pointerId = null;
  let rafPending = false;
  let wantedIndex = null;

  const getSiblingSections = () => {
    const blocks = getCurrentPageBlocks();
    return blocks
      .filter(x => (x.parentId || null) === (block.parentId ?? null) && x.type === 'section')
      .sort((a,b) => a.sort - b.sort);
  };

  const placeIndicator = () => {
    if (!indicator) return;
    const sibSections = getSiblingSections();
    const container = wrapEl.parentElement;
    if (!container) return;
    if (targetIndexSec === null) return;
    if (sibSections.length === 0) return;
    if (targetIndexSec >= sibSections.length) {
      // append at end after last section's element
      const lastEl = document.querySelector(`[data-block-id="${sibSections[sibSections.length - 1].id}"]`);
      if (lastEl && lastEl.parentElement === container) {
        container.insertBefore(indicator, lastEl.nextSibling);
      } else {
        container.appendChild(indicator);
      }
    } else {
      const targetEl = document.querySelector(`[data-block-id="${sibSections[targetIndexSec].id}"]`);
      if (targetEl && targetEl.parentElement === container) {
        container.insertBefore(indicator, targetEl);
      }
    }
  };

  const onMove = (evt) => {
    if (!dragging) return;
    const y = evt.clientY;
    const sibSections = getSiblingSections();
    const headers = sibSections.map(s => {
      const el = document.querySelector(`[data-block-id="${s.id}"] .section-header`);
      const wrap = document.querySelector(`[data-block-id="${s.id}"]`);
      return { s, el, wrap, rect: el?.getBoundingClientRect?.() };
    }).filter(x => x.el && x.rect);
    let idx = headers.length; // default to end
    for (let i = 0; i < headers.length; i++) {
      const mid = headers[i].rect.top + (headers[i].rect.height / 2);
      if (y < mid) { idx = i; break; }
    }
    wantedIndex = idx;
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (!dragging) return;
        targetIndexSec = wantedIndex;
        placeIndicator();
      });
    }
  };

  const onUp = async () => {
    if (!dragging) return;
    dragging = false;
    if (pointerId !== null) {
      try { handleEl.releasePointerCapture(pointerId); } catch {}
    }
    pointerId = null;
    wrapEl.classList.remove('is-dragging');
    if (indicator && indicator.parentElement) indicator.parentElement.removeChild(indicator);
    indicator = null;

    if (targetIndexSec === null || originalIndexSec === null || targetIndexSec === originalIndexSec) return;

    try {
      // Reorder among all siblings by computing target insertion among sections
      const blocks = getCurrentPageBlocks();
      const allSibs = blocks.filter(x => (x.parentId || null) === (block.parentId ?? null)).sort((a,b) => a.sort - b.sort);
      const secIndicesInAll = allSibs.map((n, i) => n.type === 'section' ? i : -1).filter(i => i >= 0);
      const currentIndexAll = allSibs.findIndex(x => x.id === block.id);
      if (currentIndexAll < 0) return;
      const newAll = allSibs.slice();
      const [moved] = newAll.splice(currentIndexAll, 1);
      let insertPosAll;
      if (targetIndexSec >= secIndicesInAll.length) {
        insertPosAll = secIndicesInAll.length ? (secIndicesInAll[secIndicesInAll.length - 1] + 1) : 0;
      } else {
        insertPosAll = secIndicesInAll[targetIndexSec];
        // If we removed an item before this position, the index shifts by -1
        if (currentIndexAll < insertPosAll) insertPosAll -= 1;
      }
      newAll.splice(insertPosAll, 0, moved);
      const moves = newAll.map((node, i) => ({ id: node.id, parentId: block.parentId ?? null, sort: i }));
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
    const sibSections = getSiblingSections();
    originalIndexSec = sibSections.findIndex(x => x.id === block.id);
    targetIndexSec = originalIndexSec;
    indicator = document.createElement('div');
    indicator.className = 'drag-indicator';
    // initial place
    placeIndicator();
    // Bind temporary global listeners for this drag session
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
