import { registerSelectionMenuItem } from './selectionContextMenu.js';
import { openWikilinkModal, linkWikilinkToExisting } from './wikiLinks.js';
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
              const friendly = `[[${label}]]`;
              // Insert into textarea and update local store
              insertIntoTextarea(ta, start, end, friendly);
              try {
                if (blockId) {
                  updateCurrentBlocks(b => String(b.id) === String(blockId) ? { ...b, contentJson: JSON.stringify({ ...(JSON.parse(b.contentJson || '{}') || {}), text: ta.value }) } : b);
                  // Persist immediately via editor pipeline
                  if (typeof patchBlockNow === 'function') {
                    await patchBlockNow(blockId, { content: { text: ta.value } });
                  } else {
                    debouncePatch(blockId, { content: { text: ta.value } }, 0);
                    await flushDebouncedPatches();
                  }
                }
              } catch {}
              // Link resolution to existing page id mapping
              await linkWikilinkToExisting({ title: label, blockId, token: friendly, page });
              if (window.__DEV__) try { console.debug('[wikilinks] resolved from context menu', { blockId, token: friendly, page: page?.id || page }); } catch {}
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
                  // Replace current selection with the friendly token text
                  range.deleteContents();
                  range.insertNode(document.createTextNode(friendly));
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
                } catch {}
              } else {
                // True view mode: replace first occurrence in content.text and props.html if present
                try {
                  const blocks = getCurrentPageBlocks();
                  const blk = blocks.find(b => String(b.id) === String(blockId));
                  const content = blk ? JSON.parse(blk.contentJson || '{}') : {};
                  const props = blk ? JSON.parse(blk.propsJson || '{}') : {};
                  const text = String(content?.text || '');
                  const idx = text.indexOf(originallySelected);
                  let newText = text;
                  if (idx >= 0) newText = text.slice(0, idx) + friendly + text.slice(idx + originallySelected.length);
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
                          tn.nodeValue = s.slice(0, j) + friendly + s.slice(j + originallySelected.length);
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
              // Link resolution to existing page id mapping
              await linkWikilinkToExisting({ title: label, blockId, token: friendly, page });
              if (window.__DEV__) try { console.debug('[wikilinks] resolved from context menu', { blockId, token: friendly, page: page?.id || page }); } catch {}
            }
          });
        }, 0);
      }
    }
  });
}
