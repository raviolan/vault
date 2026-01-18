import { registerSelectionMenuItem } from './selectionContextMenu.js';
import { openWikilinkModal, linkWikilinkToExisting, buildWikiTextNodes } from './wikiLinks.js';
import { updateCurrentBlocks, getCurrentPageBlocks } from '../lib/pageStore.js';
import { renderBlocksReadOnly } from '../blocks/readOnly.js';
import { debouncePatch, flushDebouncedPatches, patchBlockNow } from '../blocks/edit/state.js';
import { sanitizeRichHtml, plainTextFromHtmlContainer } from '../lib/sanitize.js';

let installed = false;

function insertIntoTextarea(ta, start, end, token) {
  const before = (ta.value || '').slice(0, start);
  const after = (ta.value || '').slice(end);
  ta.value = before + token + after;
  try { ta.focus(); } catch {}
  const pos = (before + token).length;
  try { ta.setSelectionRange(pos, pos); } catch {}
  try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
}

function deriveBlockId(ta) {
  // Prefer explicit dataset, then nearest data-block-id, then data-src-block as last resort
  const direct = ta?.dataset?.blockId;
  if (direct) return direct;
  const holder = ta?.closest?.('[data-block-id]');
  const fromClosest = holder?.getAttribute?.('data-block-id');
  if (fromClosest) return fromClosest;
  const legacy = ta?.closest?.('[data-src-block]');
  const fromLegacy = legacy?.getAttribute?.('data-src-block');
  return fromLegacy || '';
}

function rerenderReadOnlyNow() {
  try {
    const root = document.getElementById('pageBlocks');
    if (!root) return;
    renderBlocksReadOnly(root, getCurrentPageBlocks());
  } catch {}
}

export function installWikiLinksContextMenu() {
  if (installed) return;
  installed = true;
  if (window.__DEV__) try { console.debug('[wikilinks] context menu installed'); } catch {}
  registerSelectionMenuItem({
    id: 'wikilink-internal',
    label: 'Link to internal page…',
    order: 20,
    isVisible: (ctx) => (
      (ctx.kind === 'textarea' && String(ctx.selected || '').trim().length > 0)
      || (ctx.kind === 'view' && String(ctx.text || '').trim().length > 0)
    ),
    isEnabled: (ctx) => (
      (ctx.kind === 'textarea' && String(ctx.selected || '').trim().length > 0)
      || (ctx.kind === 'view' && String(ctx.text || '').trim().length > 0)
    ),
    onClick: (ctx) => {
      if (ctx.kind === 'textarea') {
        const ta = ctx.ta;
        const start = ctx.start ?? ta.selectionStart ?? 0;
        const end = ctx.end ?? ta.selectionEnd ?? 0;
        const originallySelected = String(ctx.selected || '').trim();
        if (!originallySelected) return;
        const blockId = ctx.blockId || deriveBlockId(ta);
        const token = `[[${originallySelected}]]`;
        setTimeout(() => {
          openWikilinkModal({
            title: originallySelected,
            blockId: blockId || '',
            token,
            mode: 'wikilink',
            onConfirmResolved: async ({ title, page }) => {
              const label = String(title || originallySelected);
              const newPageId = String(page?.id || '').trim();
              const current = String(ta.value || '');
              const next = applyInternalLinkAtRange(current, { start, end }, newPageId, label);
              ta.value = next;
              try { ta.focus(); } catch {}
              try { ta.setSelectionRange(Math.min(next.length, end + 1), Math.min(next.length, end + 1)); } catch {}
              try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
              try {
                if (blockId) {
                  updateCurrentBlocks(b => String(b.id) === String(blockId) ? { ...b, contentJson: JSON.stringify({ ...(JSON.parse(b.contentJson || '{}') || {}), text: next }) } : b);
                  if (typeof patchBlockNow === 'function') {
                    await patchBlockNow(blockId, { content: { text: next } });
                  } else {
                    debouncePatch(blockId, { content: { text: next } }, 0);
                    await flushDebouncedPatches();
                  }
                }
              } catch {}
              if (window.__DEV__) try { console.debug('[wikilinks] resolved from context menu (textarea)', { blockId, newPageId, label }); } catch {}
            }
          });
        }, 0);
      } else if (ctx.kind === 'view') {
        const originallySelected = String(ctx.text || '').trim();
        if (!originallySelected) return;
        const blockId = ctx.blockId;
        const token = `[[${originallySelected}]]`;
        setTimeout(() => {
          openWikilinkModal({
            title: originallySelected,
            blockId,
            token,
            mode: 'wikilink',
            onConfirmResolved: async ({ title, page }) => {
              const label = String(title || originallySelected);
              const friendly = `[[${label}]]`;
              // Branch: selection inside an editor (contentEditable) vs true read-only view
              if (ctx.editableEl && ctx.range) {
                // Edit-mode rich selection: replace DOM selection and persist html + text
                try {
                  const editableEl = ctx.editableEl;
                  const range = ctx.range;
                  // Expand selection if it's inside an existing idlink to avoid nesting
                  try {
                    const startHost = range.startContainer?.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
                    const endHost = range.endContainer?.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : range.endContainer;
                    const anchorAtStart = startHost?.closest?.('a.wikilink.idlink');
                    const anchorAtEnd = endHost?.closest?.('a.wikilink.idlink');
                    const enclosing = anchorAtStart || anchorAtEnd;
                    if (enclosing) range.selectNode(enclosing);
                  } catch {}
                  // Replace selection with canonical token directly
                  const upgraded = page?.id ? `[[page:${page.id}|${label}]]` : friendly;
                  range.deleteContents();
                  range.insertNode(document.createTextNode(upgraded));
                  // Move caret to end of inserted text
                  try {
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    const endRange = document.createRange();
                    // Create a text node at the end if necessary
                    const last = editableEl.lastChild;
                    if (last && last.nodeType === Node.TEXT_NODE) {
                      endRange.setStart(last, last.nodeValue.length);
                    } else {
                      endRange.selectNodeContents(editableEl);
                      endRange.collapse(false);
                    }
                    sel.addRange(endRange);
                  } catch {}
                  // Compute sanitized HTML and plain text
                  const html = sanitizeRichHtml(editableEl.innerHTML);
                  const text = plainTextFromHtmlContainer(editableEl);
                  // Update local store for block
                  try {
                    const blocks = getCurrentPageBlocks();
                    const blk = blocks.find(b => String(b.id) === String(blockId));
                    const content = blk ? JSON.parse(blk.contentJson || '{}') : {};
                    const props = blk ? JSON.parse(blk.propsJson || '{}') : {};
                    updateCurrentBlocks(b => String(b.id) === String(blockId)
                      ? { ...b,
                          contentJson: JSON.stringify({ ...(content || {}), text }),
                          propsJson: JSON.stringify({ ...(props || {}), html })
                        }
                      : b);
                  } catch {}
                  // Persist immediately via patch pipeline
                  if (typeof patchBlockNow === 'function') {
                    await patchBlockNow(blockId, { content: { text }, props: { html } });
                  } else {
                    debouncePatch(blockId, { content: { text }, props: { html } }, 0);
                    await flushDebouncedPatches();
                  }
                  // Linkify immediately so clicks navigate without refresh.
                  try {
                    const walker2 = document.createTreeWalker(editableEl, NodeFilter.SHOW_TEXT);
                    const nodes = [];
                    let n;
                    while ((n = walker2.nextNode())) {
                      const str = n.nodeValue || '';
                      const p = n.parentElement;
                      if (!str || !p) continue;
                      if (p.closest('a,code,pre,textarea,script,style,.inline-comment')) continue;
                      if (!str.includes('[[') && !str.includes('#')) continue;
                      nodes.push(n);
                    }
                    for (const tnode of nodes) {
                      const frag = buildWikiTextNodes(tnode.nodeValue || '', blockId);
                      if (frag && tnode.parentNode) tnode.parentNode.replaceChild(frag, tnode);
                    }
                  } catch (e) { try { console.warn('[wikilinks] immediate relinkify failed', e); } catch {} }
                } catch {}
              } else {
                // True view mode: replace first occurrence in content.text and props.html if present
                try {
                  const blocks = getCurrentPageBlocks();
                  const blk = blocks.find(b => String(b.id) === String(blockId));
                  const content = blk ? JSON.parse(blk.contentJson || '{}') : {};
                  const props = blk ? JSON.parse(blk.propsJson || '{}') : {};
                  const text = String(content?.text || '');
                  const startIdx = text.indexOf(originallySelected);
                  const newText = applyInternalLinkAtRange(text, { start: startIdx, end: startIdx >= 0 ? startIdx + originallySelected.length : startIdx }, String(page?.id || ''), label);
                  let newHtml = null;
                  if (props && typeof props.html === 'string' && props.html) {
                    try {
                      const tmp = document.createElement('div');
                      tmp.innerHTML = props.html;
                      // Replace first occurrence in text nodes only
                      const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
                      let tn;
                      let replaced = false;
                      while ((tn = walker.nextNode())) {
                        if (replaced) break;
                        const s = tn.nodeValue || '';
                        const j = s.indexOf(originallySelected);
                        if (j >= 0) {
                          const upgraded = page?.id ? `[[page:${page.id}|${label}]]` : friendly;
                          tn.nodeValue = s.slice(0, j) + upgraded + s.slice(j + originallySelected.length);
                          replaced = true;
                        }
                      }
                      newHtml = sanitizeRichHtml(tmp.innerHTML);
                    } catch {}
                  }
                  updateCurrentBlocks(b => String(b.id) === String(blockId)
                    ? { ...b,
                        contentJson: JSON.stringify({ ...(content || {}), text: newText }),
                        ...(newHtml != null ? { propsJson: JSON.stringify({ ...(props || {}), html: newHtml }) } : {})
                      }
                    : b);
                  try { rerenderReadOnlyNow(); } catch {}
                  // Persist immediately
                  if (typeof patchBlockNow === 'function') {
                    await patchBlockNow(blockId, { content: { text: newText }, ...(newHtml != null ? { props: { html: newHtml } } : {}) });
                  } else {
                    debouncePatch(blockId, { content: { text: newText }, ...(newHtml != null ? { props: { html: newHtml } } : {}) }, 0);
                    await flushDebouncedPatches();
                  }
                } catch {}
              }
              if (window.__DEV__) try { console.debug('[wikilinks] resolved from context menu (view)', { blockId, page: page?.id || page }); } catch {}
            }
          });
        }, 0);
      }
    }
  });
}

// --- Minimal helpers to make internal link apply idempotent in textarea/plain-text flows ---
function findEnclosingWikiLink(text, start, end) {
  const s = String(text || '');
  const st = Math.max(0, Number.isFinite(start) ? start : 0);
  const en = Math.max(st, Number.isFinite(end) ? end : st);
  const left = s.lastIndexOf('[[', st);
  if (left === -1) return null;
  const right = s.indexOf(']]', en - 1);
  if (right === -1) return null;
  if (s.indexOf(']]', left) !== right) return null;
  const inner = s.slice(left + 2, right);
  if (/\n/.test(inner)) return null;
  const mId = inner.match(/^page:([0-9a-fA-F-]{36})\|([\s\S]*)$/);
  const mTitle = (!mId && inner.match(/^[^\]|][\s\S]*$/)) ? [null, null, inner] : null;
  const kind = mId ? 'page' : (mTitle ? 'title' : null);
  if (!kind) return null;
  return { start: left, end: right + 2, kind, pageId: mId ? mId[1] : null, label: (mId ? mId[2] : (mTitle ? mTitle[2] : '')) };
}

function stripNestedFromLabel(label) {
  const s = String(label || '');
  let out = s;
  const re1 = /^\s*\[\[page:([0-9a-fA-F-]{36})\|([^\]]*?)\]\]\s*$/;
  const re2 = /^\s*\[\[([^\]]*?)\]\]\s*$/;
  let m;
  if ((m = out.match(re1))) out = m[2] || '';
  else if ((m = out.match(re2))) out = m[1] || '';
  return out;
}

export function applyInternalLinkAtRange(text, range, newPageId, newLabel) {
  const s = String(text || '');
  const start = Math.max(0, Number(range?.start ?? 0));
  const end = Math.max(start, Number(range?.end ?? start));
  const enc = findEnclosingWikiLink(s, start, end);
  const label = stripNestedFromLabel(newLabel || (enc ? enc.label : s.slice(start, end)));
  const replacement = newPageId ? `[[page:${newPageId}|${label}]]` : `[[${label}]]`;
  if (enc) {
    const curr = s.slice(enc.start, enc.end);
    if (curr === replacement) return s;
    return s.slice(0, enc.start) + replacement + s.slice(enc.end);
  }
  return s.slice(0, start) + replacement + s.slice(end);
}
