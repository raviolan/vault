import { debouncePatch } from './state.js';
import { apiCreateBlock, apiPatchBlock } from './apiBridge.js';
import { getCurrentPageBlocks, setCurrentPageBlocks } from '../../lib/pageStore.js';
import { refreshBlocksFromServer } from './apiBridge.js';

export function bindSectionTitleHandlers({ page, block, inputEl }) {
  inputEl.addEventListener('input', () => {
    const title = inputEl.value;
    debouncePatch(block.id, { content: { ...(block.content || {}), title } });
  });

  inputEl.addEventListener('keydown', async (e) => {
    const { apiCreateBlock, refreshBlocksFromServer } = await import('./apiBridge.js');
    const { getCurrentPageBlocks, setCurrentPageBlocks } = await import('../../lib/pageStore.js');
    const { indentBlock, outdentBlock, moveBlockWithinSiblings } = await import('./reorder.js');
    const { renderBlocksEdit } = await import('./render.js');
    const { focusBlockInput } = await import('./focus.js');

    if (e.key === 'Enter' && !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) {
      e.preventDefault();
      const kids = getCurrentPageBlocks().filter(x => (x.parentId || null) === block.id).sort((a, c) => a.sort - c.sort);
      const nextSort = kids.length ? (kids[kids.length - 1].sort + 1) : 0;
      const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: block.id, sort: nextSort, props: {}, content: { text: '' } });
      setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
      await refreshBlocksFromServer(page.id);
      const container = document.getElementById('pageBlocks');
      renderBlocksEdit(container, page, getCurrentPageBlocks());
      focusBlockInput(created.id);
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
  });
}

export function bindSectionHeaderControls({ page, block, rootEl, titleInput, onAfterChange, focus }) {
  const header = rootEl.querySelector('.section-header');
  const toggle = header.querySelector('.section-toggle');
  const addBtn = header.querySelector('.section-add');

  toggle.addEventListener('click', async () => {
    const wasActive = document.activeElement && rootEl.contains(document.activeElement);
    try {
      const next = { ...(block.props || {}), collapsed: !block.props?.collapsed };
      await apiPatchBlock(block.id, { props: next });
      await refreshBlocksFromServer(page.id);
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
      await refreshBlocksFromServer(page.id);
      await onAfterChange();
      focus(created.id);
    } catch (e) { console.error('add child failed', e); }
  });
}
