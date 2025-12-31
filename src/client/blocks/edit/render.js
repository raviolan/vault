import { parseMaybeJson, blocksToTree } from '../tree.js';
import { getCurrentPageBlocks, setCurrentPageBlocks, updateCurrentBlocks } from '../../lib/pageStore.js';
import { bindTextInputHandlers, bindRichTextHandlers } from './handlersText.js';
import { bindSectionTitleHandlers, bindSectionHeaderControls, insertFirstChildParagraph } from './handlersSection.js';
import { debouncePatch } from './state.js';
import { focusBlockInput } from './focus.js';
import { bindAutosizeTextarea } from '../../lib/autosizeTextarea.js';
import { insertMarkdownLink } from '../../lib/formatShortcuts.js';
import { sanitizeRichHtml, plainTextFromHtmlContainer } from '../../lib/sanitize.js';
import { buildWikiTextNodes } from '../../features/wikiLinks.js';
import { getState, updateState, saveStateNow } from '../../lib/state.js';
import { applyUiPrefsToBody } from '../../lib/uiPrefs.js';

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

// Local helper: linkify [[wikilinks]] and #hashtags inside a DOM subtree while editing.
function linkifyWikiTokensInElement(rootEl, blockId) {
  if (!rootEl) return;
  try {
    const txt = rootEl.textContent || '';
    if (!txt || (!txt.includes('[[') && !txt.includes('#'))) return;
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) {
      const s = n.nodeValue || '';
      if (!s) continue;
      const p = n.parentElement;
      if (!p) continue;
      if (p.closest('a,code,pre,textarea,script,style')) continue;
      if (!s.includes('[[') && !s.includes('#')) continue;
      nodes.push(n);
    }
    for (const tn of nodes) {
      const frag = buildWikiTextNodes(tn.nodeValue || '', blockId);
      if (frag && tn.parentNode) tn.parentNode.replaceChild(frag, tn);
    }
  } catch {}
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

// PRIVATE: inject toolbar if missing and return references
function ensureEditorToolbar(hostEl, rootEl) {
  if (!hostEl) return { created: false, toolbarEl: null, refs: {} };
  const existing = hostEl.querySelector('#editorToolbar');
  if (existing) {
    const byId = (id) => existing.querySelector(`#${id}`);
    return {
      created: false,
      toolbarEl: existing,
      refs: {
        typeSelectEl: byId('tbType'),
        boldBtnEl: byId('tbBold'),
        italicBtnEl: byId('tbItalic'),
        quoteBtnEl: byId('tbQuote'),
        linkBtnEl: byId('tbLink'),
        addH1BtnEl: byId('tbAddH1'),
        addH2BtnEl: byId('tbAddH2'),
        addH3BtnEl: byId('tbAddH3'),
        addBodyBtnEl: byId('tbAddBody'),
        highlightToggleEl: byId('tbSectionHL')
      }
    };
  }
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
          <button type="button" id="tbQuote" title="Quote">Quote</button>
          <button type="button" id="tbLink" title="Link (Cmd+Opt+K)">Link</button>
          <span class="sep"></span>
          <button type="button" id="tbAddH1" class="chip">+ H1</button>
          <button type="button" id="tbAddH2" class="chip">+ H2</button>
          <button type="button" id="tbAddH3" class="chip">+ H3</button>
          <button type="button" id="tbAddBody" class="chip">+ Body</button>
          <span class="sep"></span>
          <button type="button" id="tbSectionHL" class="chip" title="Toggle section highlight">Section HL</button>
        </div>`;
  hostEl.insertBefore(tb, rootEl);
  const byId = (id) => tb.querySelector(`#${id}`);
  return {
    created: true,
    toolbarEl: tb,
      refs: {
      typeSelectEl: byId('tbType'),
      boldBtnEl: byId('tbBold'),
      italicBtnEl: byId('tbItalic'),
      quoteBtnEl: byId('tbQuote'),
      linkBtnEl: byId('tbLink'),
      addH1BtnEl: byId('tbAddH1'),
      addH2BtnEl: byId('tbAddH2'),
      addH3BtnEl: byId('tbAddH3'),
      addBodyBtnEl: byId('tbAddBody'),
      highlightToggleEl: byId('tbSectionHL')
    }
  };
}

// PRIVATE: outline helpers; returns helpers used by toolbar and render
function buildOutlineIndex() {
  function getById(all, id) { return all.find(x => String(x.id) === String(id)); }
  function getProps(b) { return b?.props || parseMaybeJson(b?.propsJson) || {}; }
  function getLevel(b) { const p = getProps(b); return Number(p.level || 0) || 0; }
  function getParent(all, b) { if (!b?.parentId) return null; return getById(all, b.parentId); }
  function getPathToRoot(all, cur) {
    const path = [];
    let n = cur;
    while (n) { path.push(n); n = getParent(all, n); }
    return path; // leaf-first
  }
  function firstInPathWithParent(path, parentId) {
    for (const n of path) {
      if ((n.parentId ?? null) === (parentId ?? null)) return n;
    }
    return null;
  }
  function computeHeadingInsert(all, cur, desiredLevel) {
    if (!cur) {
      const roots = all.filter(b => (b.parentId ?? null) === null).sort((a,b)=>Number(a.sort||0)-Number(b.sort||0));
      const last = roots[roots.length-1] || null;
      return { parentId: null, sortBase: last ? Number(last.sort||0) : -1 };
    }
    const path = getPathToRoot(all, cur);
    const ancestors = path.filter(n => n.type === 'section');
    let parentId = null;
    if (desiredLevel === 1) {
      parentId = null;
    } else {
      const want = desiredLevel - 1;
      let parentSec = ancestors.find(s => getLevel(s) === want);
      if (!parentSec) parentSec = ancestors.find(s => getLevel(s) > 0 && getLevel(s) < desiredLevel) || null;
      parentId = parentSec ? parentSec.id : null;
    }
    const directChild = firstInPathWithParent(path, parentId);
    const sortBase = directChild ? Number(directChild.sort||0) : (
      (() => {
        const sibs = all.filter(b => (b.parentId ?? null) === (parentId ?? null));
        return sibs.length ? Math.max(...sibs.map(s => Number(s.sort||0))) : -1;
      })()
    );
    return { parentId, sortBase };
  }
  function computeBodyInsert(all, cur) {
    if (!cur) {
      const roots = all.filter(b => (b.parentId ?? null) === null).sort((a,b)=>Number(a.sort||0)-Number(b.sort||0));
      const last = roots[roots.length-1] || null;
      return { parentId: null, sortBase: last ? Number(last.sort||0) : -1 };
    }
    if ((cur.parentId ?? null) === null) return { parentId: null, sortBase: Number(cur.sort||0) };
    if (cur.type === 'section') {
      return { parentId: cur.parentId ?? null, sortBase: Number(cur.sort || 0) };
    }
    const path = getPathToRoot(all, cur);
    const nearestSection = path.find(n => n.type === 'section');
    if (nearestSection) {
      return { parentId: nearestSection.parentId ?? null, sortBase: Number(nearestSection.sort || 0) };
    }
    return { parentId: cur.parentId ?? null, sortBase: Number(cur.sort || 0) };
  }
  return { getById, getProps, getLevel, getParent, getPathToRoot, firstInPathWithParent, computeHeadingInsert, computeBodyInsert };
}

// PRIVATE: bind toolbar button/select actions (only once)
function bindToolbarActions({ page, rootEl, refs, outline }) {
  const byRef = (k) => refs?.[k] || null;

  const selType = byRef('typeSelectEl');
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
      const { apiPatchBlock, apiCreateBlock } = await import('./apiBridge.js');
      if (cur.type === 'section') {
        const existingProps = parseMaybeJson(cur.propsJson) || {};
        const nextProps = { ...existingProps, level };
        await apiPatchBlock(cur.id, { props: nextProps });
        updateCurrentBlocks(b => b.id === cur.id ? { ...b, propsJson: JSON.stringify(nextProps) } : b);
        const container = document.getElementById('pageBlocks');
        stableRender(container, page, getCurrentPageBlocks(), cur.id);
        return;
      }
      if (cur.type === 'heading') {
        const existingProps = parseMaybeJson(cur.propsJson) || {};
        const nextProps = { ...existingProps, level };
        await apiPatchBlock(cur.id, { props: nextProps });
        updateCurrentBlocks(b => b.id === cur.id ? { ...b, propsJson: JSON.stringify(nextProps) } : b);
        const container = document.getElementById('pageBlocks');
        stableRender(container, page, getCurrentPageBlocks(), cur.id);
        return;
      }
      if (cur.type === 'paragraph') {
        const text = String((parseMaybeJson(cur.contentJson)?.text) || '').replace(/\r\n/g, '\n');
        const lines = text.split('\n');
        const title = (lines[0] || '').trim() || 'Untitled';
        const remainder = lines.slice(1).join('\n').replace(/\s+$/,'');
        const existingProps = parseMaybeJson(cur.propsJson) || {};
        const nextProps = { ...existingProps, collapsed: false, level };
        await apiPatchBlock(cur.id, { type: 'section', props: nextProps, content: { title } });
        updateCurrentBlocks(b => b.id === cur.id ? { ...b, type: 'section', propsJson: JSON.stringify(nextProps), contentJson: JSON.stringify({ title }) } : b);
        if (remainder && remainder.trim().length) {
          const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: cur.id, sort: 0, props: {}, content: { text: remainder } });
          setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
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
  const insertOrToggleInlineQuoteRich = (editable) => {
    if (!editable || !editable.isContentEditable) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!editable.contains(range.commonAncestorContainer)) return;
    try {
      // Toggle off if selection lies within the same inline-quote span
      const startEl = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement);
      const endEl = (range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement);
      const q1 = startEl?.closest?.('.inline-quote') || null;
      const q2 = endEl?.closest?.('.inline-quote') || null;
      if (q1 && q1 === q2) {
        const target = q1;
        const parent = target.parentNode;
        if (parent) {
          const frag = document.createDocumentFragment();
          while (target.firstChild) frag.appendChild(target.firstChild);
          parent.replaceChild(frag, target);
        }
        return;
      }
      // Wrap selection in a span.inline-quote
      const frag = range.extractContents();
      const span = document.createElement('span');
      span.className = 'inline-quote';
      span.appendChild(frag);
      range.insertNode(span);
      // Move caret to after the inserted span
      try {
        const r = document.createRange();
        r.setStartAfter(span);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      } catch {}
    } catch {}
  };

  const btnHL = byRef('highlightToggleEl');
  if (btnHL) {
    btnHL.addEventListener('click', () => {
      try {
        const st = getState() || {};
        const on = st?.uiPrefsV1?.sectionHeaderHighlight !== false;
        const next = { ...(st.uiPrefsV1 || {}), sectionHeaderHighlight: !on };
        updateState({ uiPrefsV1: next });
        try { saveStateNow(); } catch {}
        applyUiPrefsToBody({ ...(st || {}), uiPrefsV1: next });
      } catch {}
    });
  }

  function createSectionAfterActiveFactory(level) {
    return async () => {
      const id = activeBlockId;
      const all = getCurrentPageBlocks();
      const cur = id ? all.find(x => String(x.id) === String(id)) : null;
      const { parentId, sortBase } = outline.computeHeadingInsert(all, cur, level);
      try {
        const { apiCreateBlock } = await import('./apiBridge.js');
        const created = await apiCreateBlock(page.id, { type: 'section', parentId, sort: Number(sortBase || 0) + 1, props: { collapsed: false, level }, content: { title: '' } });
        setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
        const container = document.getElementById('pageBlocks') || rootEl;
        stableRender(container, page, getCurrentPageBlocks(), created.id);
      } catch (err) { console.error('toolbar create section failed', err); }
    };
  }

  async function createBodyAfterActive() {
    const id = activeBlockId;
    const all = getCurrentPageBlocks();
    const cur = id ? all.find(x => String(x.id) === String(id)) : null;
    try {
      if (cur && cur.type === 'section') {
        await insertFirstChildParagraph({ page, sectionId: cur.id, rootEl });
        return;
      }
      const { parentId, sortBase } = outline.computeBodyInsert(all, cur);
      const { apiCreateBlock } = await import('./apiBridge.js');
      const created = await apiCreateBlock(page.id, {
        type: 'paragraph',
        parentId,
        sort: Number(sortBase || 0) + 1,
        props: {},
        content: { text: '' }
      });
      setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
      const container = document.getElementById('pageBlocks') || rootEl;
      stableRender(container, page, getCurrentPageBlocks(), created.id);
    } catch (err) { console.error('toolbar create body failed', err); }
  }

  byRef('boldBtnEl')?.addEventListener('click', () => {
    const el = ensureRichActive(); if (!el) return;
    try { document.execCommand('bold'); } catch {}
    triggerSave(el);
  });
  byRef('italicBtnEl')?.addEventListener('click', () => {
    const el = ensureRichActive(); if (!el) return;
    try { document.execCommand('italic'); } catch {}
    triggerSave(el);
  });
  // Prevent losing selection on toolbar press
  byRef('quoteBtnEl')?.addEventListener('mousedown', (e) => { try { e.preventDefault(); } catch {} });
  byRef('quoteBtnEl')?.addEventListener('click', () => {
    const richEl = ensureRichActive();
    if (richEl) {
      insertOrToggleInlineQuoteRich(richEl);
      triggerSave(richEl);
      return;
    }
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
      (async () => {
        const { toggleWrapSelectionPair } = await import('../../lib/formatShortcuts.js');
        toggleWrapSelectionPair(ae, '{{q: ', '}}');
      })().catch(() => {});
      return;
    }
    // For other cases (no eligible selection), ignore quietly
  });
  byRef('linkBtnEl')?.addEventListener('click', () => {
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

  byRef('addH1BtnEl')?.addEventListener('click', () => void createSectionAfterActiveFactory(1)());
  byRef('addH2BtnEl')?.addEventListener('click', () => void createSectionAfterActiveFactory(2)());
  byRef('addH3BtnEl')?.addEventListener('click', () => void createSectionAfterActiveFactory(3)());
  byRef('addBodyBtnEl')?.addEventListener('click', () => void createBodyAfterActive());
}

// PRIVATE: track focus to set activeBlockId and sync toolbar select
function ensureFocusTracker(rootEl) {
  try {
    if (!rootEl.__focusTrackerBound) {
      rootEl.__focusTrackerBound = true;
      rootEl.addEventListener('focusin', () => {
        const ae = document.activeElement;
        const blockEl = ae?.closest?.('.block[data-block-id]');
        if (blockEl) {
          activeBlockId = blockEl.getAttribute('data-block-id');
          const selType = rootEl.parentElement?.querySelector?.('#editorToolbar #tbType');
          if (selType) {
            try {
              const all = getCurrentPageBlocks();
              const cur = all.find(x => String(x.id) === String(activeBlockId));
              if (cur?.type === 'section') {
                const parsed = parseMaybeJson(cur.propsJson) || {};
                const lvl = Math.min(3, Math.max(1, Number(parsed.level || 1)));
                selType.value = `h${lvl}`;
              } else if (cur?.type === 'heading') {
                const parsed = parseMaybeJson(cur.propsJson) || {};
                const lvl = Math.min(3, Math.max(1, Number(parsed.level || 1)));
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
}

// PRIVATE: main DOM creation/render loop
function renderEditorDom({ rootEl, page }) {
  if (!getCurrentPageBlocks().length) {
    const empty = document.createElement('div');
    empty.innerHTML = `<div class="block" data-block-id="" data-parent-id="">\n      <textarea class="block-input" placeholder="Start typing..."></textarea>\n    </div>`;
    const ta = empty.querySelector('textarea');
    ta.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const { apiCreateBlock } = await import('./apiBridge.js');
        const { getCurrentPageBlocks } = await import('../../lib/pageStore.js');
        const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: null, sort: 0, props: {}, content: { text: '' } });
        setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
        stableRender(rootEl, page, getCurrentPageBlocks(), created.id);
      }
    });
    rootEl.innerHTML = '';
    rootEl.appendChild(empty.firstElementChild);
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
        // Render committed wiki tokens as anchors so UUIDs stay hidden
        linkifyWikiTokensInElement(div, b.id);
      } else {
        div.textContent = String(b.content?.text || '');
      }
      div.placeholder = 'Write something...';
      // Prevent navigation when clicking links inside the editor
      div.addEventListener('click', (e) => {
        const a = e.target?.closest?.('a');
        if (!a) return;
        try { e.preventDefault(); e.stopPropagation(); } catch {}
      }, true);
      wrap.appendChild(div);
      bindRichTextHandlers({ page, block: b, editableEl: div, orderedBlocksFlat, render: renderStable, focus });
    } else if (b.type === 'divider') {
      const hr = document.createElement('hr');
      wrap.appendChild(hr);
    } else if (b.type === 'section') {
      const lvl = Math.min(3, Math.max(0, Number((b.props && b.props.level) || 0)));
      const header = document.createElement('div');
      header.className = 'section-header';
      const initiallyCollapsed = !!(b.props?.collapsed || b.props?.completed);
      header.dataset.collapsed = initiallyCollapsed ? '1' : '0';
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
      toggle.textContent = initiallyCollapsed ? '▸' : '▾';
      toggle.setAttribute('aria-label', 'Toggle');
      toggle.setAttribute('aria-expanded', initiallyCollapsed ? 'false' : 'true');
      header.appendChild(toggle);
      const title = document.createElement('input');
      title.className = 'block-input section-title';
      if (lvl) title.classList.add(`h${lvl}`);
      title.placeholder = lvl === 1 ? 'Heading 1' : (lvl === 2 ? 'Heading 2' : (lvl === 3 ? 'Heading 3' : 'Section title'));
      title.value = b.content?.title || '';
      header.appendChild(title);

      const controls = document.createElement('div');
      controls.className = 'section-controls';
      // Completion checkbox (H1–H3 only) at far-right of controls
      if (lvl >= 1 && lvl <= 3) {
        const completeWrap = document.createElement('label');
        completeWrap.className = 'section-complete';
        completeWrap.title = 'Mark section complete (collapses by default)';
        const complete = document.createElement('input');
        complete.type = 'checkbox';
        complete.className = 'section-complete-checkbox';
        complete.checked = !!b.props?.completed;
        const stop = (e) => { try { e.stopPropagation(); e.stopImmediatePropagation?.(); } catch {} };
        complete.addEventListener('pointerdown', stop, true);
        complete.addEventListener('click', stop, true);
        complete.addEventListener('change', (e) => {
          const checked = !!complete.checked;
          const next = { ...(b.props || {}), completed: checked };
          try { (0, debouncePatch)(b.id, { props: next }); } catch {}
          // Immediate collapse on check (DOM only; no force-expand on uncheck)
          if (checked) {
            try {
              header.dataset.collapsed = '1';
              toggle.textContent = '▸';
              toggle.setAttribute('aria-expanded', 'false');
              const kidsWrap = wrap.querySelector('.section-children');
              if (kidsWrap) kidsWrap.style.display = 'none';
            } catch {}
          }
        });
        completeWrap.appendChild(complete);
        const dot = document.createElement('span');
        dot.className = 'section-complete-dot';
        completeWrap.appendChild(dot);
        controls.appendChild(completeWrap);
      }

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
      delBtn.title = 'Remove heading (keeps content)';
      delBtn.hidden = true;
      controls.appendChild(delBtn);

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'chip section-add';
      addBtn.textContent = '+';
      addBtn.title = 'Add child paragraph';
      controls.appendChild(addBtn);

      header.appendChild(controls);
      wrap.classList.add('section-block');
      if (lvl) wrap.classList.add(`section--lvl${lvl}`); else wrap.classList.add('section--plain');
      wrap.appendChild(header);

      const kidsWrap = document.createElement('div');
      kidsWrap.className = 'section-children';
      kidsWrap.style.paddingLeft = '16px';
      if (initiallyCollapsed) kidsWrap.style.display = 'none';
      wrap.appendChild(kidsWrap);

      bindSectionHeaderControls({ page, block: b, rootEl: wrap, titleInput: title, onAfterChange: async () => { renderStable(b.id); }, focus });
      bindSectionTitleHandlers({ page, block: b, inputEl: title, rootEl: wrap, renderStable: renderStable, focus });
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

// PRIVATE: finalize step placeholder for parity
function finalizeRender() { /* no-op; behavior unchanged */ }

export function renderBlocksEdit(rootEl, page, blocks) {
  setCurrentPageBlocks(blocks);
  try {
    const host = rootEl.parentElement;
    const { created, refs } = ensureEditorToolbar(host, rootEl);
    const outline = buildOutlineIndex();
    if (created) bindToolbarActions({ page, rootEl, refs, outline });
  } catch {}

  ensureFocusTracker(rootEl);

  renderEditorDom({ rootEl, page });
  finalizeRender();
}
