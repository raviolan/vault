import { debouncePatch } from './state.js';
import { apiCreateBlock, apiDeleteBlock } from './apiBridge.js';
import { apiPatchBlock } from './apiBridge.js';
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
    const chunks = []; // { type: 'section'|'paragraph', level?:1|2|3, title?|text? }
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
        chunks.push({ type: 'section', level, title: htxt });
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
    if (first.type === 'section') {
      // Convert block to section with appropriate level
      try {
        await apiPatchBlock(block.id, { type: 'section', props: { ...(block.props||{}), collapsed: false, level: first.level }, content: { title: first.title || '' } });
      } catch (err) {
        console.error('Failed to convert block to section on paste', err);
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
      const payload = ch.type === 'section'
        ? { type: 'section', parentId: block.parentId ?? null, sort, props: { collapsed: false, level: ch.level }, content: { title: ch.title || '' } }
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

    // Normalize outline from levels so that H2/H3 nest and paragraphs move under current section
    try {
      const { normalizeOutlineFromLevels } = await import('./outline.js');
      await normalizeOutlineFromLevels(page);
    } catch (err) { console.error('normalizeOutlineFromLevels failed', err); }

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

    // Quick heading triggers on Space only, parsing only first line
    if (block.type === 'paragraph' && (e.key === ' ' || e.code === 'Space')) {
      const val = String(inputEl.value || '');
      const lines = val.split('\n');
      const firstLine = lines[0] || '';
      const remainder = lines.slice(1).join('\n');

      // Only trigger when caret is within the first line
      const caretPos = inputEl.selectionStart ?? 0;
      const firstNewlineIdx = val.indexOf('\n');
      const caretInFirstLine = (firstNewlineIdx === -1) ? true : (caretPos <= firstNewlineIdx);
      if (!caretInFirstLine) {
        // Let normal space insert if not in first line
        // (no preventDefault here)
      } else {
        // Detect /h1 /h2 /h3 and Markdown #/##/### on the first line
        const slash = firstLine.match(/^\s*\/(h[123])(?:\s+(.*))?$/i);
        const md1 = firstLine.match(/^\s*(#{1,3})(?:\s+(.*))?$/);
        let level = 0;
        let title = '';
        if (slash) {
          const h = slash[1].toLowerCase();
          level = Number(h.slice(1));
          title = (slash[2] || '').replace(/^\s+/, '');
        } else if (md1) {
          level = Math.min(3, Math.max(1, md1[1].length));
          title = (md1[2] || '').trim();
        }

        if (level >= 1 && level <= 3) {
          e.preventDefault();
          try {
            // Convert current block to section with title
            await apiPatchBlock(block.id, { type: 'section', props: { ...(block.props||{}), collapsed: false, level }, content: { title } });
          } catch (err) {
            console.error('Quick heading conversion failed (apiPatchBlock)', err);
            return; // do not continue if conversion failed
          }

          // Refresh to ensure section exists in store
          await refreshBlocksFromServer(page.id);

          // If remainder exists, create a child paragraph as first child of the new section
          let createdChildId = null;
          const remainderTrimmed = remainder.trimEnd();
          if (remainderTrimmed.trim().length > 0) {
            try {
              const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: block.id, sort: 0, props: {}, content: { text: remainderTrimmed } });
              createdChildId = created?.id || null;
            } catch (err) {
              console.error('Quick heading: failed creating child paragraph from remainder', err);
            }
            await refreshBlocksFromServer(page.id);
          }

          // Normalize outline levels and refresh
          try {
            const { normalizeOutlineFromLevels } = await import('./outline.js');
            await normalizeOutlineFromLevels(page);
          } catch (err) {
            console.error('normalize after quick heading failed', err);
          }
          await refreshBlocksFromServer(page.id);

          // Re-render using provided render() callback
          render();

          // Focus behavior
          try {
            const { focusBlockInput } = await import('./focus.js');
            if (!title || title.trim().length === 0) {
              // Focus section title input if title empty
              focusBlockInput(block.id);
            } else if (createdChildId) {
              // Focus the created child paragraph
              focusBlockInput(createdChildId);
            } else {
              // Focus section title
              focusBlockInput(block.id);
            }
          } catch (_) {
            // Fallback to generic focus callback
            if (!title || title.trim().length === 0) focus(block.id);
            else if (createdChildId) focus(createdChildId);
            else focus(block.id);
          }
          return;
        }
      }
    }

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
