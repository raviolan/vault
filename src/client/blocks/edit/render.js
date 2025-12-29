import { parseMaybeJson, blocksToTree } from '../tree.js';
import { getCurrentPageBlocks, setCurrentPageBlocks } from '../../lib/pageStore.js';
import { bindTextInputHandlers, bindRichTextHandlers } from './handlersText.js';
import { bindSectionTitleHandlers, bindSectionHeaderControls } from './handlersSection.js';
import { focusBlockInput } from './focus.js';
import { bindAutosizeTextarea } from '../../lib/autosizeTextarea.js';
import { insertMarkdownLink } from '../../lib/formatShortcuts.js';
import { sanitizeRichHtml, plainTextFromHtmlContainer } from '../../lib/sanitize.js';

// Track active block across the editor for toolbar actions
let activeBlockId = null;
export function getActiveBlockId() { return activeBlockId; }

function parseBlock(b) {
  return { ...b, props: parseMaybeJson(b.propsJson), content: parseMaybeJson(b.contentJson) };
}

function getScrollContainer(rootEl) {
  let el = rootEl;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = getComputedStyle(el);
    const overflowY = style.overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
    el = el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function scrollerViewportTop(scroller) {
  return scroller === (document.scrollingElement || document.documentElement) ? 0 : (scroller.getBoundingClientRect?.().top || 0);
}

function scrollerViewportBottom(scroller) {
  const top = scrollerViewportTop(scroller);
  const height = scroller === (document.scrollingElement || document.documentElement) ? window.innerHeight : (scroller.clientHeight || (scroller.getBoundingClientRect?.().height || 0));
  return top + height;
}

function captureAnchor(rootEl, scroller) {
  try {
    const viewTop = scrollerViewportTop(scroller);
    const viewBottom = scrollerViewportBottom(scroller);
    const blocks = Array.from(rootEl.querySelectorAll('.block[data-block-id]'));
    for (const el of blocks) {
      const rect = el.getBoundingClientRect?.();
      if (!rect) continue;
      if (rect.bottom > viewTop && rect.top < viewBottom) {
        const anchorId = el.getAttribute('data-block-id');
        const anchorTopDelta = rect.top - viewTop;
        return { anchorId, anchorTopDelta };
      }
    }
  } catch {}
  return null;
}

function textOffsetIn(el, container) {
  // Compute linear text offset within container (count <br> as one char)
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
  let node = walker.currentNode;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
  const range = sel.getRangeAt(0);
  let start = null; let end = null;
  function advanceThrough(n) {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = n.nodeValue?.length || 0;
      if (n === range.startContainer) start = offset + Math.min(range.startOffset, len);
      if (n === range.endContainer) end = offset + Math.min(range.endOffset, len);
      offset += len;
    } else if (n.nodeType === Node.ELEMENT_NODE && (n.tagName || '').toUpperCase() === 'BR') {
      if (n === range.startContainer) start = offset; // rare when container is element
      if (n === range.endContainer) end = offset;
      offset += 1; // count <br> as one char
    }
  }
  // Walk all nodes depth-first
  const all = [];
  while (node) { all.push(node); node = walker.nextNode(); }
  for (const n of all) advanceThrough(n);
  if (start == null || end == null) {
    // Fallback: set to end
    start = end = offset;
  }
  return { start, end };
}

function setTextOffset(container, start, end) {
  // Restore selection from linear text offsets within container
  const sel = window.getSelection();
  if (!sel) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
  let node = walker.currentNode;
  let offset = 0;
  let startNode = null, startOff = 0;
  let endNode = null, endOff = 0;
  function consume(n) {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = n.nodeValue?.length || 0;
      if (startNode == null && start <= offset + len) {
        startNode = n;
        startOff = Math.max(0, start - offset);
      }
      if (endNode == null && end <= offset + len) {
        endNode = n;
        endOff = Math.max(0, end - offset);
      }
      offset += len;
    } else if (n.nodeType === Node.ELEMENT_NODE && (n.tagName || '').toUpperCase() === 'BR') {
      if (startNode == null && start <= offset + 1) {
        startNode = n.parentNode || container;
        startOff = Array.prototype.indexOf.call((startNode.childNodes || []), n) + 1;
      }
      if (endNode == null && end <= offset + 1) {
        endNode = n.parentNode || container;
        endOff = Array.prototype.indexOf.call((endNode.childNodes || []), n) + 1;
      }
      offset += 1;
    }
  }
  const all = [];
  while (node) { all.push(node); node = walker.nextNode(); }
  for (const n of all) consume(n);
  if (!startNode) { startNode = container; startOff = container.childNodes.length; }
  if (!endNode) { endNode = container; endOff = container.childNodes.length; }
  try {
    const range = document.createRange();
    range.setStart(startNode, Math.max(0, startOff));
    range.setEnd(endNode, Math.max(0, endOff));
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {}
}

function captureSelection() {
  const ae = document.activeElement;
  if (!ae) return null;
  const isTextInput = (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) && ae.classList.contains('block-input');
  const isRich = !isTextInput && ae.isContentEditable && ae.classList.contains('block-input') && ae.classList.contains('block-rich');
  if (!(isTextInput || isRich)) return null;
  const p = ae.closest?.('.block[data-block-id]');
  const blockId = p?.getAttribute?.('data-block-id');
  if (!blockId) return null;
  try {
    if (isTextInput) {
      const start = ae.selectionStart ?? 0;
      const end = ae.selectionEnd ?? start;
      const tag = ae.tagName;
      return { blockId, start, end, tag, rich: false };
    } else if (isRich) {
      const { start, end } = textOffsetIn(ae, ae);
      return { blockId, start, end, tag: 'DIV', rich: true };
    }
  } catch {}
  return { blockId, start: null, end: null, tag: ae.tagName, rich: isRich };
}

function restoreAnchor(rootEl, scroller, anchor) {
  if (!anchor || !anchor.anchorId) return;
  try {
    const el = rootEl.querySelector(`.block[data-block-id="${CSS.escape(anchor.anchorId)}"]`);
    if (!el) return;
    const viewTop = scrollerViewportTop(scroller);
    const rect = el.getBoundingClientRect?.();
    if (!rect) return;
    const delta = (rect.top - viewTop) - anchor.anchorTopDelta;
    if (Math.abs(delta) > 0.5) {
      scroller.scrollTop += delta;
    }
  } catch {}
}

function restoreSelection(sel) {
  if (!sel || !sel.blockId) return;
  try {
    const blockEl = document.querySelector(`.block[data-block-id="${CSS.escape(sel.blockId)}"]`);
    if (!blockEl) return;
    const el = sel.rich ? blockEl.querySelector('.block-input.block-rich') : blockEl.querySelector('.block-input');
    if (!el) return;
    el.focus();
    if (!sel.rich && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && sel.start != null && sel.end != null) {
      try { el.setSelectionRange(sel.start, sel.end); } catch {}
    } else if (sel.rich && sel.start != null && sel.end != null) {
      setTextOffset(el, sel.start, sel.end);
    }
  } catch {}
}

export function stableRender(rootEl, page, blocks, preferFocusId = null) {
  const scroller = getScrollContainer(rootEl);
  const anchor = captureAnchor(rootEl, scroller);
  const sel = captureSelection();
  renderBlocksEdit(rootEl, page, blocks);
  requestAnimationFrame(() => {
    try { restoreAnchor(rootEl, scroller, anchor); } catch {}
    if (preferFocusId) {
      try { focusBlockInput(preferFocusId); } catch {}
    } else {
      try { restoreSelection(sel); } catch {}
    }
  });
}

export function renderBlocksEdit(rootEl, page, blocks) {
  setCurrentPageBlocks(blocks);
  // One-time toolbar + focus tracker setup
  try {
    const host = rootEl.parentElement;
    if (host && !host.querySelector('#editorToolbar')) {
      const tb = document.createElement('div');
      tb.id = 'editorToolbar';
      tb.className = 'editor-toolbar';
      tb.innerHTML = `
        <div class="row">
          <select id="tbType">
            <option value="p">Paragraph</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
          </select>
          <span class="sep"></span>
          <button type="button" id="tbBold" title="Bold (Ctrl+B)"><b>B</b></button>
          <button type="button" id="tbItalic" title="Italic (Ctrl+I)"><i>I</i></button>
          <button type="button" id="tbLink" title="Link (Cmd+Opt+K)">Link</button>
          <span class="sep"></span>
          <button type="button" id="tbAddH1" class="chip">+ H1</button>
          <button type="button" id="tbAddH2" class="chip">+ H2</button>
          <button type="button" id="tbAddH3" class="chip">+ H3</button>
        </div>`;
      host.insertBefore(tb, rootEl);

      // Event wiring
      const byId = (id) => tb.querySelector(`#${id}`);
      const selType = byId('tbType');
      selType?.addEventListener('change', async () => {
        const id = activeBlockId;
        if (!id) return;
        const levelMap = { h1: 1, h2: 2, h3: 3 };
        const v = selType.value;
        if (v === 'p') return; // no-op for now
        const level = levelMap[v] || 2;
        const all = getCurrentPageBlocks();
        const cur = all.find(x => String(x.id) === String(id));
        if (!cur) return;
        try {
          const { apiPatchBlock, apiCreateBlock, refreshBlocksFromServer } = await import('./apiBridge.js');
          if (cur.type === 'section') {
            await apiPatchBlock(cur.id, { props: { ...(cur.props || {}), level } });
            await refreshBlocksFromServer(page.id);
            const container = document.getElementById('pageBlocks');
            stableRender(container, page, getCurrentPageBlocks(), cur.id);
            return;
          }
          if (cur.type === 'paragraph') {
            // Convert paragraph to section: title = first line of plain text; remainder as child paragraph
            const text = String((cur.content?.text) || '').replace(/\r\n/g, '\n');
            const lines = text.split('\n');
            const title = (lines[0] || '').trim() || 'Untitled';
            const remainder = lines.slice(1).join('\n').replace(/\s+$/,'');
            await apiPatchBlock(cur.id, { type: 'section', props: { ...(cur.props || {}), collapsed: false, level }, content: { title } });
            await refreshBlocksFromServer(page.id);
            if (remainder && remainder.trim().length) {
              const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: cur.id, sort: 0, props: {}, content: { text: remainder } });
              void created; // no-op; server refresh ensures consistency
              await refreshBlocksFromServer(page.id);
            }
            const container = document.getElementById('pageBlocks');
            stableRender(container, page, getCurrentPageBlocks(), cur.id);
          }
        } catch (err) { console.error('toolbar heading change failed', err); }
      });

      const ensureRichActive = () => {
        const ae = document.activeElement;
        if (!ae) return null;
        const isRich = ae && ae.isContentEditable && ae.classList.contains('block-rich');
        return isRich ? ae : null;
      };
      const triggerSave = (el) => { try { el?.dispatchEvent(new Event('input', { bubbles: true })); } catch {} };

      byId('tbBold')?.addEventListener('click', () => {
        const el = ensureRichActive(); if (!el) return;
        try { document.execCommand('bold'); } catch {}
        triggerSave(el);
      });
      byId('tbItalic')?.addEventListener('click', () => {
        const el = ensureRichActive(); if (!el) return;
        try { document.execCommand('italic'); } catch {}
        triggerSave(el);
      });
      byId('tbLink')?.addEventListener('click', () => {
        const ae = document.activeElement;
        const richEl = ensureRichActive();
        if (richEl) {
          const sel = window.getSelection();
          const url = window.prompt('Link URL:');
          if (!url) return;
          try {
            if (sel && !sel.isCollapsed) {
              document.execCommand('createLink', false, url);
            } else {
              // No selection in rich text: insert the URL as plain text
              document.execCommand('insertText', false, url);
            }
          } catch {}
          triggerSave(richEl);
          return;
        }
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
          insertMarkdownLink(ae);
          return;
        }
      });

      async function createSectionAfterActive(level) {
        const id = activeBlockId;
        const all = getCurrentPageBlocks();
        const cur = id ? all.find(x => String(x.id) === String(id)) : null;
        let parentId = null; let sort = -1;
        if (cur) { parentId = cur.parentId ?? null; sort = Number(cur.sort || 0); }
        else {
          const roots = all.filter(x => (x.parentId || null) === null).sort((a,b) => a.sort - b.sort);
          const last = roots[roots.length - 1] || null;
          parentId = null; sort = last ? Number(last.sort || 0) : -1;
        }
        try {
          const { apiCreateBlock, refreshBlocksFromServer } = await import('./apiBridge.js');
          const created = await apiCreateBlock(page.id, { type: 'section', parentId, sort: sort + 1, props: { collapsed: false, level }, content: { title: '' } });
          await refreshBlocksFromServer(page.id);
          const container = document.getElementById('pageBlocks');
          stableRender(container, page, getCurrentPageBlocks(), created.id);
        } catch (err) { console.error('toolbar create section failed', err); }
      }
      byId('tbAddH1')?.addEventListener('click', () => void createSectionAfterActive(1));
      byId('tbAddH2')?.addEventListener('click', () => void createSectionAfterActive(2));
      byId('tbAddH3')?.addEventListener('click', () => void createSectionAfterActive(3));
    }
  } catch {}

  // Track focus to set active block and sync toolbar selection
  try {
    if (!rootEl.__focusTrackerBound) {
      rootEl.__focusTrackerBound = true;
      rootEl.addEventListener('focusin', () => {
        const ae = document.activeElement;
        const blockEl = ae?.closest?.('.block[data-block-id]');
        if (blockEl) {
          activeBlockId = blockEl.getAttribute('data-block-id');
          // Update toolbar dropdown to reflect current block type
          const selType = rootEl.parentElement?.querySelector?.('#editorToolbar #tbType');
          if (selType) {
            try {
              const all = getCurrentPageBlocks();
              const cur = all.find(x => String(x.id) === String(activeBlockId));
              if (cur?.type === 'section') {
                const lvl = Math.min(3, Math.max(1, Number(cur.props?.level || 1)));
                selType.value = `h${lvl}`;
              } else {
                selType.value = 'p';
              }
            } catch {}
          }
        }
      });
    }
  } catch {}
  if (!getCurrentPageBlocks().length) {
    const empty = document.createElement('div');
    empty.innerHTML = `<div class="block" data-block-id="" data-parent-id="">\n      <textarea class="block-input" placeholder="Start typing..."></textarea>\n    </div>`;
    const ta = empty.querySelector('textarea');
    ta.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const { apiCreateBlock, refreshBlocksFromServer } = await import('./apiBridge.js');
        const { getCurrentPageBlocks } = await import('../../lib/pageStore.js');
        const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: null, sort: 0, props: {}, content: { text: '' } });
        await refreshBlocksFromServer(page.id);
        stableRender(rootEl, page, getCurrentPageBlocks(), created.id);
      }
    });
    rootEl.innerHTML = '';
    rootEl.appendChild(empty.firstElementChild);
    // Autosize and focus initial canvas input
    try { bindAutosizeTextarea(ta); } catch {}
    setTimeout(() => ta.focus(), 0);
    return;
  }

  rootEl.innerHTML = '';
  const tree = blocksToTree(getCurrentPageBlocks());

  function orderedBlocksFlat() {
    const arr = getCurrentPageBlocks().slice();
    return arr.sort((a,b) => ((a.parentId||'') === (b.parentId||'')) ? (a.sort - b.sort) : (String(a.parentId||'').localeCompare(String(b.parentId||'')) || (a.sort - b.sort)));
  }

  function renderNodeEdit(rawNode, depth = 0) {
    const b = parseBlock(rawNode);
    const wrap = document.createElement('div');
    wrap.className = 'block';
    wrap.setAttribute('data-block-id', b.id);
    wrap.setAttribute('data-parent-id', b.parentId || '');

    const renderStable = (preferFocusId = null) => stableRender(rootEl, page, getCurrentPageBlocks(), preferFocusId);
    const focus = (id) => focusBlockInput(id);

    if (b.type === 'heading') {
      const level = Math.min(3, Math.max(1, Number((b.props && b.props.level) || 2)));
      const input = document.createElement('input');
      input.className = 'block-input heading';
      input.value = b.content?.text || '';
      input.placeholder = level === 1 ? 'Heading 1' : (level === 2 ? 'Heading 2' : 'Heading 3');
      wrap.appendChild(input);
      bindTextInputHandlers({ page, block: b, inputEl: input, orderedBlocksFlat, render: renderStable, focus });
    } else if (b.type === 'paragraph') {
      const div = document.createElement('div');
      div.className = 'block-input paragraph block-rich';
      div.contentEditable = 'true';
      div.setAttribute('data-block-id', b.id);
      const html = (b.props && b.props.html) ? String(b.props.html) : null;
      if (html && html.trim()) {
        div.innerHTML = sanitizeRichHtml(html);
      } else {
        div.textContent = String(b.content?.text || '');
      }
      div.placeholder = 'Write something...';
      wrap.appendChild(div);
      bindRichTextHandlers({ page, block: b, editableEl: div, orderedBlocksFlat, render: renderStable, focus });
    } else if (b.type === 'divider') {
      const hr = document.createElement('hr');
      wrap.appendChild(hr);
    } else if (b.type === 'section') {
      const lvl = Math.min(3, Math.max(0, Number((b.props && b.props.level) || 0)));
      const header = document.createElement('div');
      header.className = 'section-header';
      // Expose collapsed state for CSS styling
      header.dataset.collapsed = b.props?.collapsed ? '1' : '0';
      // Drag handle (before toggle)
      const dragBtn = document.createElement('button');
      dragBtn.type = 'button';
      dragBtn.className = 'section-drag';
      dragBtn.setAttribute('aria-label', 'Drag to reorder');
      dragBtn.title = 'Drag to reorder';
      dragBtn.textContent = '⋮⋮';
      header.appendChild(dragBtn);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'section-toggle';
      toggle.textContent = b.props?.collapsed ? '▸' : '▾';
      toggle.setAttribute('aria-label', 'Toggle');
      toggle.setAttribute('aria-expanded', b.props?.collapsed ? 'false' : 'true');
      header.appendChild(toggle);
      const title = document.createElement('input');
      title.className = 'block-input section-title';
      if (lvl) title.classList.add(`h${lvl}`);
      title.placeholder = lvl === 1 ? 'Heading 1' : (lvl === 2 ? 'Heading 2' : (lvl === 3 ? 'Heading 3' : 'Section title'));
      title.value = b.content?.title || '';
      header.appendChild(title);

      // Controls container (right-aligned): up, down, delete-empty, add
      const controls = document.createElement('div');
      controls.className = 'section-controls';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'chip section-move-up';
      upBtn.textContent = '↑';
      upBtn.title = 'Move up (Ctrl/Cmd+↑)';
      controls.appendChild(upBtn);

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'chip section-move-down';
      downBtn.textContent = '↓';
      downBtn.title = 'Move down (Ctrl/Cmd+↓)';
      controls.appendChild(downBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'chip section-delete-empty';
      delBtn.textContent = '×';
      delBtn.title = 'Delete empty section';
      delBtn.hidden = true; // visibility controlled by handlers
      controls.appendChild(delBtn);

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'chip section-add';
      addBtn.textContent = '+';
      addBtn.title = 'Add child paragraph';
      controls.appendChild(addBtn);

      header.appendChild(controls);
      // Mark as a section block for styling/drag state
      wrap.classList.add('section-block');
      if (lvl) wrap.classList.add(`section--lvl${lvl}`); else wrap.classList.add('section--plain');
      wrap.appendChild(header);

      const kidsWrap = document.createElement('div');
      kidsWrap.className = 'section-children';
      kidsWrap.style.paddingLeft = '16px';
      if (b.props?.collapsed) kidsWrap.style.display = 'none';
      wrap.appendChild(kidsWrap);

      bindSectionHeaderControls({ page, block: b, rootEl: wrap, titleInput: title, onAfterChange: async () => { renderStable(b.id); }, focus });
      bindSectionTitleHandlers({ page, block: b, inputEl: title, rootEl: wrap, renderStable: renderStable, focus });
      // Bind drag on sections only
      (async () => {
        const { bindSectionDrag } = await import('./handlersSection.js');
        bindSectionDrag({ page, block: b, wrapEl: wrap, headerEl: header, handleEl: dragBtn, onAfterChange: async () => { renderStable(b.id); }, focus });
      })().catch(() => {});

      for (const child of rawNode.children) kidsWrap.appendChild(renderNodeEdit(child, depth + 1));
      return wrap;
    } else {
      const pre = document.createElement('pre');
      pre.className = 'meta';
      pre.textContent = JSON.stringify({ type: b.type, content: b.content }, null, 2);
      wrap.appendChild(pre);
    }

    if (rawNode.children && rawNode.children.length) {
      const kidsWrap = document.createElement('div');
      kidsWrap.className = 'section-children';
      kidsWrap.style.paddingLeft = '16px';
      for (const child of rawNode.children) kidsWrap.appendChild(renderNodeEdit(child, depth + 1));
      wrap.appendChild(kidsWrap);
    }

    return wrap;
  }

  for (const node of tree) rootEl.appendChild(renderNodeEdit(node, 0));
}
