import { parseMaybeJson, blocksToTree } from '../tree.js';
import { getCurrentPageBlocks, setCurrentPageBlocks } from '../../lib/pageStore.js';
import { bindTextInputHandlers } from './handlersText.js';
import { bindSectionTitleHandlers, bindSectionHeaderControls } from './handlersSection.js';
import { focusBlockInput } from './focus.js';
import { bindAutosizeTextarea } from '../../lib/autosizeTextarea.js';

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

function captureSelection() {
  const ae = document.activeElement;
  if (!ae) return null;
  if (!(ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement)) return null;
  if (!ae.classList.contains('block-input')) return null;
  let p = ae.closest?.('.block[data-block-id]');
  const blockId = p?.getAttribute?.('data-block-id');
  if (!blockId) return null;
  try {
    const start = ae.selectionStart ?? 0;
    const end = ae.selectionEnd ?? start;
    const tag = ae.tagName;
    return { blockId, start, end, tag };
  } catch {
    return { blockId, start: null, end: null, tag: ae.tagName };
  }
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
    const el = document.querySelector(`.block[data-block-id="${CSS.escape(sel.blockId)}"] .block-input`);
    if (!el) return;
    el.focus();
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && sel.start != null && sel.end != null) {
      try { el.setSelectionRange(sel.start, sel.end); } catch {}
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
      const ta = document.createElement('textarea');
      ta.className = 'block-input paragraph';
      ta.value = b.content?.text || '';
      ta.placeholder = 'Write something...';
      wrap.appendChild(ta);
      bindTextInputHandlers({ page, block: b, inputEl: ta, orderedBlocksFlat, render: renderStable, focus });
      try { bindAutosizeTextarea(ta); } catch {}
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
