import { registerSelectionMenuItem, getSelectionContextForInlineActions } from './selectionContextMenu.js';
import { getCurrentPageBlocks, updateCurrentBlocks } from '../lib/pageStore.js';
import { parseMaybeJson } from '../blocks/tree.js';
import { apiPatchBlock } from '../blocks/api.js';
import { renderBlocksReadOnly } from '../blocks/readOnly.js';

// Hovercard (reuse generic .hovercard styles; keep separate from Open5e hover)
let hoverEl = null;
let hoverTimer = null;

function ensureHover() {
  if (hoverEl) return hoverEl;
  const el = document.createElement('div');
  el.className = 'hovercard inline-comment-hover';
  el.style.display = 'none';
  document.body.appendChild(el);
  hoverEl = el;
  return el;
}

function hideHover() {
  const el = ensureHover();
  el.style.display = 'none';
  el.innerHTML = '';
}

function positionHover(target) {
  const el = ensureHover();
  const r = target.getBoundingClientRect();
  const pad = 14; // extra breathing room for inline comments
  // measure current hover height for above placement
  el.style.display = 'block';
  el.style.visibility = 'hidden';
  const measuredH = el.offsetHeight || 0;
  el.style.visibility = '';

  const vw = document.documentElement.clientWidth || window.innerWidth;
  const maxW = Math.min(340, Math.max(260, vw - 24));
  el.style.maxWidth = `${maxW}px`;
  const estW = Math.min(maxW, Math.max(200, (r.width || 200)));

  // Default: place ABOVE
  let top = r.top + window.scrollY - pad - measuredH;
  let left = r.left + window.scrollX;
  // Flip below if off-screen
  if (top < window.scrollY + 8) top = r.bottom + window.scrollY + pad;
  // Prevent right overflow
  if (left + estW + 12 > window.scrollX + vw) left = Math.max(12, window.scrollX + vw - estW - 12);

  // Scoped absolute positioning for this variant
  el.style.position = 'absolute';
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function rerenderReadOnlyNow() {
  try {
    const root = document.getElementById('pageBlocks');
    if (!root) return;
    renderBlocksReadOnly(root, getCurrentPageBlocks());
  } catch {}
}

function getBlockById(id) {
  return getCurrentPageBlocks().find(b => String(b.id) === String(id));
}

function parsePropsJson(json) { try { return parseMaybeJson(json) || {}; } catch { return {}; } }
function parseContentJson(json) { try { return parseMaybeJson(json) || {}; } catch { return {}; } }

function upsertCommentProps(blockId, commentId, commentText) {
  const blk = getBlockById(blockId);
  const props = parsePropsJson(blk?.propsJson);
  const next = { ...(props || {}), comments: { ...(props?.comments || {}), [commentId]: String(commentText || '') } };
  return apiPatchBlock(blockId, { props: next });
}

function removeCommentProps(blockId, commentId) {
  const blk = getBlockById(blockId);
  const props = parsePropsJson(blk?.propsJson);
  const map = { ...(props?.comments || {}) };
  delete map[commentId];
  const next = { ...(props || {}), comments: map };
  return apiPatchBlock(blockId, { props: next });
}

function localMergeBlock(blockId, patch) {
  updateCurrentBlocks((b) => {
    if (String(b.id) !== String(blockId)) return b;
    const props = parsePropsJson(b.propsJson);
    const content = parseContentJson(b.contentJson);
    const nextProps = patch?.props ? { ...props, ...patch.props } : props;
    const nextContent = patch?.content ? { ...content, ...patch.content } : content;
    return {
      ...b,
      propsJson: JSON.stringify(nextProps),
      contentJson: JSON.stringify(nextContent),
    };
  });
}

function tokenForComment(id, label) {
  return `[[cmt:${id}|${label}]]`;
}

async function insertCommentInTextarea({ ta, start, end, label, text }) {
  const id = crypto.randomUUID();
  const token = tokenForComment(id, label);
  const before = (ta.value || '').slice(0, start);
  const after = (ta.value || '').slice(end);
  ta.value = before + token + after;
  const pos = start + token.length;
  try { ta.setSelectionRange(pos, pos); } catch {}
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  // Persist comment text on props and mirror token into props.html when present
  const blockId = ta?.dataset?.blockId || ta.closest?.('[data-block-id]')?.getAttribute?.('data-block-id') || '';
  if (blockId) {
    try {
      const blk = getBlockById(blockId);
      const props = parsePropsJson(blk?.propsJson);
      const comments = { ...(props?.comments || {}), [id]: String(text || '') };
      let nextHtml = null;
      const orig = String(label || '').trim();
      try {
        const html = String(props?.html || '');
        if (html && orig && html.includes(orig)) {
          const tmp = document.createElement('div');
          tmp.innerHTML = html;
          const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
          let tn; let replaced = false;
          while ((tn = walker.nextNode())) {
            if (replaced) break;
            const s = tn.nodeValue || '';
            const j = s.indexOf(orig);
            if (j >= 0) { tn.nodeValue = s.slice(0, j) + token + s.slice(j + orig.length); replaced = true; }
          }
          if (replaced) nextHtml = tmp.innerHTML;
        }
      } catch {}
      await apiPatchBlock(blockId, { props: { ...(props || {}), comments, ...(nextHtml != null ? { html: nextHtml } : {}) } });
      // Optimistically update local store
      localMergeBlock(blockId, { props: { ...(props || {}), comments, ...(nextHtml != null ? { html: nextHtml } : {}) } });
    } catch {
      // Fallback to simple comment text upsert
      await upsertCommentProps(blockId, id, text);
    }
  }
}

async function insertCommentInView({ blockId, term, label, text }) {
  const blk = getBlockById(blockId);
  const content = parseContentJson(blk?.contentJson);
  const props = parsePropsJson(blk?.propsJson);
  const raw = String(content?.text || '');
  const occIdx = raw.indexOf(term);
  if (occIdx < 0) throw new Error('Selection not found in block');
  if (raw.indexOf(term, occIdx + term.length) !== -1) {
    alert('Term appears multiple times in this block. Edit to place precisely.');
    return;
  }
  const id = crypto.randomUUID();
  const token = tokenForComment(id, label);
  const nextText = raw.slice(0, occIdx) + token + raw.slice(occIdx + term.length);
  // Also attempt to replace in props.html when present
  let nextHtml = null;
  try {
    const html = String(props?.html || '');
    if (html && term && html.includes(term)) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
      let tn; let replaced = false;
      while ((tn = walker.nextNode())) {
        if (replaced) break;
        const s = tn.nodeValue || '';
        const j = s.indexOf(term);
        if (j >= 0) {
          tn.nodeValue = s.slice(0, j) + token + s.slice(j + term.length);
          replaced = true;
        }
      }
      nextHtml = tmp.innerHTML;
    }
  } catch {}
  await apiPatchBlock(blockId, { content: { ...(content || {}), text: nextText }, ...(nextHtml != null ? { props: { ...(props || {}), html: nextHtml } } : {}) });
  localMergeBlock(blockId, { content: { text: nextText }, ...(nextHtml != null ? { props: { html: nextHtml } } : {}) });
  await upsertCommentProps(blockId, id, text);
  rerenderReadOnlyNow();
}

async function editComment({ blockId, commentId, newText }) {
  await upsertCommentProps(blockId, commentId, newText);
  // Optimistically update DOM datasets for current spans
  try {
    document.querySelectorAll(`.inline-comment[data-comment-id="${CSS.escape(commentId)}"]`).forEach((el) => {
      el.setAttribute('data-comment', newText);
    });
  } catch {}
}

async function deleteComment({ blockId, commentId, label }) {
  const blk = getBlockById(blockId);
  const content = parseContentJson(blk?.contentJson);
  const props = parsePropsJson(blk?.propsJson);
  const token = tokenForComment(commentId, label);
  let nextText = String(content?.text || '');
  if (nextText.includes(token)) nextText = nextText.replace(token, label);
  let nextHtml = null;
  try {
    const html = String(props?.html || '');
    if (html && html.includes(token)) {
      nextHtml = html.replace(token, label);
    }
  } catch {}
  await apiPatchBlock(blockId, { content: { ...(content || {}), text: nextText }, ...(nextHtml != null ? { props: { ...(props || {}), html: nextHtml } } : {}) });
  localMergeBlock(blockId, { content: { text: nextText }, ...(nextHtml != null ? { props: { html: nextHtml } } : {}) });
  await removeCommentProps(blockId, commentId);
  rerenderReadOnlyNow();
}

// Modal helpers (reuse generic modal container styles)
function getCommentModal() { return document.getElementById('inlineCommentModal'); }

function openCommentModal({ mode, blockId, textarea, start, end, label, term, commentId, existingText }) {
  const modal = getCommentModal();
  if (!modal) return;
  modal.dataset.mode = mode || 'create';
  modal.dataset.blockId = blockId || '';
  modal.dataset.textarea = textarea ? '1' : '';
  modal.dataset.start = String(start ?? '');
  modal.dataset.end = String(end ?? '');
  modal.dataset.term = term || '';
  modal.dataset.label = label || '';
  modal.dataset.commentId = commentId || '';
  const titleEl = modal.querySelector('.inlineCommentTitle');
  const labelEl = modal.querySelector('.inlineCommentLabel');
  const input = modal.querySelector('textarea[name="inlineCommentText"]');
  const delBtn = modal.querySelector('.modal-delete');
  if (titleEl) titleEl.textContent = mode === 'edit' ? 'Edit Comment' : 'Add Comment';
  if (labelEl) labelEl.textContent = label || '';
  if (input) input.value = existingText || '';
  if (delBtn) delBtn.style.display = mode === 'edit' ? '' : 'none';
  modal.style.display = '';
  setTimeout(() => { try { input?.focus(); input?.select(); } catch {} }, 0);
}

function closeCommentModal() { const m = getCommentModal(); if (m) m.style.display = 'none'; }

function wireCommentModal() {
  const modal = getCommentModal();
  if (!modal) return;
  const input = modal.querySelector('textarea[name="inlineCommentText"]');
  const btnCancel = modal.querySelector('.modal-cancel');
  const btnSave = modal.querySelector('.modal-confirm');
  const btnDel = modal.querySelector('.modal-delete');
  btnCancel?.addEventListener('click', () => closeCommentModal());
  btnSave?.addEventListener('click', async () => {
    const mode = modal.dataset.mode || 'create';
    const blockId = modal.dataset.blockId || '';
    const label = modal.dataset.label || '';
    const text = input?.value || '';
    try {
      if (mode === 'edit') {
        const id = modal.dataset.commentId || '';
        await editComment({ blockId, commentId: id, newText: text });
      } else if (modal.dataset.textarea === '1') {
        // Textarea-backed selection (edit mode plain textarea)
        const ta = document.querySelector(`textarea.block-input[data-block-id="${CSS.escape(blockId)}"]`) || document.activeElement;
        const start = Number(modal.dataset.start || 0);
        const end = Number(modal.dataset.end || 0);
        await insertCommentInTextarea({ ta, start, end, label, text });
      } else if (modal.dataset.term) {
        await insertCommentInView({ blockId, term: modal.dataset.term, label, text });
      }
    } catch (e) {
      console.error('inline comment save failed', e);
      alert('Failed to save comment.');
    } finally {
      closeCommentModal();
    }
  });
  btnDel?.addEventListener('click', async () => {
    const id = modal.dataset.commentId || '';
    const blockId = modal.dataset.blockId || '';
    const label = modal.dataset.label || '';
    try { await deleteComment({ blockId, commentId: id, label }); }
    catch (e) { console.error('comment delete failed', e); alert('Failed to delete comment.'); }
    finally { closeCommentModal(); }
  });
}

function handleHoverBehavior() {
  document.addEventListener('pointerover', (e) => {
    const el = e.target?.closest?.('.inline-comment');
    if (!el) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      try {
        const hc = ensureHover();
        const text = el.getAttribute('data-comment') || '';
        hc.innerHTML = `<div style="font-size:12px; white-space:normal;">${(text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
        hc.style.display = 'block';
        positionHover(el);
      } catch {}
    }, 160);
  });
  document.addEventListener('pointerout', (e) => {
    const el = e.target?.closest?.('.inline-comment');
    if (!el) return;
    clearTimeout(hoverTimer);
    hideHover();
  });
  window.addEventListener('scroll', hideHover, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideHover(); });
}

function handleClickBehavior() {
  document.addEventListener('click', (e) => {
    const el = e.target?.closest?.('.inline-comment');
    if (!el) return;
    const blockId = el.closest?.('[data-block-id]')?.getAttribute?.('data-block-id') || '';
    const commentId = el.getAttribute('data-comment-id') || '';
    const label = el.textContent || '';
    const text = el.getAttribute('data-comment') || '';
    e.preventDefault();
    e.stopPropagation();
    openCommentModal({ mode: 'edit', blockId, commentId, existingText: text, label });
  });
}

function registerContextMenuItems() {
  // Add comment (visible with non-empty selection)
  registerSelectionMenuItem({
    id: 'inline-comment-add',
    label: 'Add comment…',
    order: 20,
    isVisible: (ctx) => (
      (ctx.kind === 'textarea' && String(ctx.selected || '').trim())
      || (ctx.kind === 'view' && String(ctx.text || '').trim())
    ),
    isEnabled: (ctx) => (
      (ctx.kind === 'textarea' && String(ctx.selected || '').trim())
      || (ctx.kind === 'view' && String(ctx.text || '').trim())
    ),
    onClick: async (ctx) => {
      if (ctx.kind === 'textarea') {
        const label = String(ctx.selected || '').trim();
        openCommentModal({ mode: 'create', textarea: true, blockId: ctx.blockId || (ctx.ta?.dataset?.blockId || ''), start: ctx.start, end: ctx.end, label });
      } else if (ctx.kind === 'view') {
        const label = String(ctx.text || '').trim();
        openCommentModal({ mode: 'create', blockId: ctx.blockId, term: label, label });
      }
    }
  });

  // Edit existing comment
  registerSelectionMenuItem({
    id: 'inline-comment-edit',
    label: 'Edit comment…',
    order: 21,
    isVisible: (ctx) => (ctx && ctx.kind === 'inline-comment' && !!ctx.commentId),
    isEnabled: (ctx) => (ctx && ctx.kind === 'inline-comment' && !!ctx.commentId),
    onClick: async (ctx) => {
      try {
        const el = ctx.el;
        const label = ctx.label || el?.textContent || '';
        const text = el?.getAttribute?.('data-comment') || '';
        openCommentModal({ mode: 'edit', blockId: ctx.blockId, commentId: ctx.commentId, existingText: text, label });
      } catch {}
    }
  });

  // Delete existing comment
  registerSelectionMenuItem({
    id: 'inline-comment-delete',
    label: 'Delete comment',
    order: 22,
    isVisible: (ctx) => (ctx && ctx.kind === 'inline-comment' && !!ctx.commentId),
    isEnabled: (ctx) => (ctx && ctx.kind === 'inline-comment' && !!ctx.commentId),
    onClick: async (ctx) => {
      if (!ctx?.commentId) return;
      try { await deleteComment({ blockId: ctx.blockId, commentId: ctx.commentId, label: String(ctx.label || '') }); }
      catch (e) { console.error('comment delete failed', e); alert('Failed to delete comment.'); }
    }
  });
}

function installShortcut() {
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const code = String(e.code || '');
    const key = String(e.key || '').toLowerCase();
    const isCombo = e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && (code === 'KeyM' || key === 'm');
    if (!isCombo) return;
    const ctx = getSelectionContextForInlineActions();
    if (!ctx) return;
    e.preventDefault();
    if (ctx.kind === 'textarea') {
      const label = String(ctx.selected || '').trim();
      openCommentModal({ mode: 'create', textarea: true, blockId: ctx.blockId || (ctx.ta?.dataset?.blockId || ''), start: ctx.start, end: ctx.end, label });
    } else if (ctx.kind === 'view') {
      const label = String(ctx.text || '').trim();
      openCommentModal({ mode: 'create', blockId: ctx.blockId, term: label, label });
    }
  }, true);
}

export function installInlineComments() {
  ensureHover();
  wireCommentModal();
  handleHoverBehavior();
  handleClickBehavior();
  registerContextMenuItems();
  installShortcut();
}
