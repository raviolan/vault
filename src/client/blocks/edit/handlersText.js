import { debouncePatch } from './state.js';
import { apiCreateBlock, apiDeleteBlock } from './apiBridge.js';
import { getCurrentPageBlocks, setCurrentPageBlocks } from '../../lib/pageStore.js';
import { refreshBlocksFromServer } from './apiBridge.js';
import { hideSlashMenuPublic, maybeHandleSlashMenu, isSlashMenuFor } from './slashMenu.js';
import { indentBlock, outdentBlock, moveBlockWithinSiblings } from './reorder.js';

export function bindTextInputHandlers({ page, block, inputEl, orderedBlocksFlat, render, focus }) {
  inputEl.addEventListener('input', () => {
    const text = inputEl.value;
    debouncePatch(block.id, { content: { ...(block.content || {}), text } });
    maybeHandleSlashMenu({ page, block, inputEl, orderedBlocksFlat, onAfterChange: async () => { render(); focus(block.id); } });
  });

  inputEl.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { hideSlashMenuPublic(); return; }
    if (e.key === 'Enter' && !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) {
      if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
        e.preventDefault();
        const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: block.parentId ?? null, sort: Number(block.sort || 0) + 1, props: {}, content: { text: '' } });
        setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
        render();
        focus(created.id);
        await refreshBlocksFromServer(page.id);
      }
    } else if (e.key === 'Backspace' && (inputEl.value || '').trim() === '') {
      if (block.type === 'paragraph') {
        e.preventDefault();
        const siblings = getCurrentPageBlocks().filter(x => (x.parentId || null) === (block.parentId || null)).sort((a,b) => a.sort - b.sort);
        const idx = siblings.findIndex(x => x.id === block.id);
        const prev = idx > 0 ? siblings[idx-1] : null;
        await apiDeleteBlock(block.id).catch(() => {});
        setCurrentPageBlocks(getCurrentPageBlocks().filter(x => x.id !== block.id));
        render();
        if (prev) focus(prev.id);
        await refreshBlocksFromServer(page.id);
      }
    } else if (e.key === 'Tab' && !(e.ctrlKey || e.metaKey || e.altKey)) {
      e.preventDefault();
      hideSlashMenuPublic();
      const result = e.shiftKey ? await outdentBlock(page, block) : await indentBlock(page, block);
      render();
      if (result?.focusId) focus(result.focusId);
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      hideSlashMenuPublic();
      const result = await moveBlockWithinSiblings(page, block, e.key === 'ArrowUp' ? -1 : 1);
      render();
      if (result?.focusId) focus(result.focusId);
    }
  });

  inputEl.addEventListener('focus', () => maybeHandleSlashMenu({ page, block, inputEl, orderedBlocksFlat, onAfterChange: async () => { render(); focus(block.id); } }));
  inputEl.addEventListener('blur', () => { setTimeout(() => { if (isSlashMenuFor(block.id)) hideSlashMenuPublic(); }, 150); });
}
