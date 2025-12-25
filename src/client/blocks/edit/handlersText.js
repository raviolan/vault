import { debouncePatch } from './state.js';
import { apiCreateBlock, apiDeleteBlock } from './apiBridge.js';
import { getCurrentPageBlocks, setCurrentPageBlocks } from '../../lib/pageStore.js';
import { refreshBlocksFromServer } from './apiBridge.js';
import { hideSlashMenuPublic, maybeHandleSlashMenu, isSlashMenuFor } from './slashMenu.js';
import { indentBlock, outdentBlock, moveBlockWithinSiblings } from './reorder.js';
import { markDirty } from './state.js';
import { handleFormatShortcutKeydown } from '../../lib/formatShortcuts.js';

export function bindTextInputHandlers({ page, block, inputEl, orderedBlocksFlat, render, focus }) {
  inputEl.addEventListener('input', () => {
    const text = inputEl.value;
    markDirty();
    debouncePatch(block.id, { content: { ...(block.content || {}), text } });
    maybeHandleSlashMenu({ page, block, inputEl, orderedBlocksFlat, onAfterChange: async () => { render(); focus(block.id); } });
  });
  
  // Smart Paste: Intercept only when clipboard contains multi-line content,
  // blank-line paragraph separators, or markdown-style headings ("#", "##", "###" at line start).
  // This turns large pastes into sensible blocks without changing schemas.
  inputEl.addEventListener('paste', async (e) => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text) return; // let browser handle empty/other types

    const raw = text.replace(/\r\n/g, '\n');
    const hasTwoNewlines = (raw.match(/\n/g) || []).length >= 2;
    const hasBlankParagraph = /\n\s*\n/.test(raw);
    const hasMdHeading = /^(\s{0,3}#{1,3})\s+/m.test(raw);
    if (!(hasTwoNewlines || hasBlankParagraph || hasMdHeading)) return; // default paste

    e.preventDefault();

    // Parse into chunks: treat markdown headings as their own chunks, and
    // aggregate non-heading lines into paragraph chunks split by blank lines.
    const lines = raw.split(/\n/);
    const chunks = []; // { type: 'heading'|'paragraph', level?:1|2|3, text }
    let para = [];
    const flushPara = () => {
      if (para.length) {
        // Preserve single newlines within paragraph for readability
        const ptxt = para.join('\n').replace(/\s+$/,'');
        if (ptxt.trim().length) chunks.push({ type: 'paragraph', text: ptxt });
        para = [];
      }
    };

    for (const line of lines) {
      if (!line.trim()) { // blank line -> new paragraph
        flushPara();
        continue;
      }
      const m = line.match(/^\s{0,3}(#{1,3})\s+(.*)$/);
      if (m) {
        flushPara();
        const level = Math.min(3, Math.max(1, m[1].length));
        const htxt = (m[2] || '').trimEnd();
        chunks.push({ type: 'heading', level, text: htxt });
        continue;
      }
      para.push(line);
    }
    flushPara();

    if (!chunks.length) return; // nothing special; should not happen

    // Insert blocks starting at the current one. Replace current with first chunk.
    // After insert, focus lands in the last inserted block.
    const { apiCreateBlock, apiPatchBlock } = await import('./apiBridge.js');
    const { getCurrentPageBlocks, setCurrentPageBlocks } = await import('../../lib/pageStore.js');

    // Helper to compute sort position relative to current block among siblings
    const siblings = getCurrentPageBlocks().filter(x => (x.parentId || null) === (block.parentId || null)).sort((a,b) => a.sort - b.sort);
    const idx = siblings.findIndex(x => x.id === block.id);
    const baseSort = Number(block.sort || 0);

    // Apply first chunk to current block
    const first = chunks[0];
    if (first.type === 'heading') {
      // Convert block to heading of appropriate level
      try {
        await apiPatchBlock(block.id, { type: 'heading', props: { ...(block.props||{}), level: first.level }, content: { text: first.text } });
      } catch (err) {
        console.error('Failed to convert block to heading on paste', err);
      }
    } else {
      try {
        await apiPatchBlock(block.id, { type: 'paragraph', props: { ...(block.props||{}) }, content: { text: first.text } });
      } catch (err) {
        console.error('Failed to patch paragraph on paste', err);
      }
    }

    // Create remaining chunks as new blocks after current, preserving order
    const createdIds = [];
    let sort = baseSort + 1;
    for (let i = 1; i < chunks.length; i++) {
      const ch = chunks[i];
      const payload = ch.type === 'heading'
        ? { type: 'heading', parentId: block.parentId ?? null, sort, props: { level: ch.level }, content: { text: ch.text } }
        : { type: 'paragraph', parentId: block.parentId ?? null, sort, props: {}, content: { text: ch.text } };
      try {
        const created = await apiCreateBlock(page.id, payload);
        createdIds.push(created.id);
        // Update local store so immediate render keeps order responsive
        setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
      } catch (err) {
        console.error('Failed to create block from paste chunk', err);
      }
      sort += 1;
    }

    // Re-render and refresh data; focus last inserted block (or current if single chunk)
    render();
    const focusId = createdIds.length ? createdIds[createdIds.length - 1] : block.id;
    focus(focusId);
    await refreshBlocksFromServer(page.id);
  });

  inputEl.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { hideSlashMenuPublic(); return; }
    // Bold/Italic shortcuts
    if (handleFormatShortcutKeydown(e, inputEl)) return;

    // Option/Alt + Enter — explicit new block after current
    if ((e.key === 'Enter') && e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat) {
      e.preventDefault();
      const isSection = !!e.shiftKey; // Option+Shift+Enter => create Section
      const payload = isSection
        ? { type: 'section', parentId: block.parentId ?? null, sort: Number(block.sort || 0) + 1, props: { collapsed: false }, content: { title: '' } }
        : { type: 'paragraph', parentId: block.parentId ?? null, sort: Number(block.sort || 0) + 1, props: {}, content: { text: '' } };
      try {
        const created = await apiCreateBlock(page.id, payload);
        setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
        render();
        focus(created.id); // For section, focuses the title input
        await refreshBlocksFromServer(page.id);
      } catch (err) {
        console.error('Failed to create block via Option+Enter', err);
      }
      return;
    }

    // Plain Enter on textarea — insert newline inside current block (do not split)
    if (e.key === 'Enter' && !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) {
      if (inputEl.tagName === 'TEXTAREA') {
        // Allow default newline insertion; autosize will grow height
        return;
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
