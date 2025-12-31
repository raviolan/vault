// Thin shared selection context menu utility
// - Listens for contextmenu when there is a meaningful selection
// - Builds a context object for textarea or view selections
// - Renders a small custom menu and dispatches to registered items

const registry = [];
let menuEl = null;
let cleanup = [];

export function registerSelectionMenuItem(def) {
  if (!def || !def.id) return () => {};
  const item = {
    id: def.id,
    label: def.label || def.id,
    order: typeof def.order === 'number' ? def.order : 0,
    isVisible: typeof def.isVisible === 'function' ? def.isVisible : (() => true),
    isEnabled: typeof def.isEnabled === 'function' ? def.isEnabled : (() => true),
    onClick: typeof def.onClick === 'function' ? def.onClick : (() => {}),
  };
  registry.push(item);
  registry.sort((a,b) => (a.order - b.order) || a.label.localeCompare(b.label));
  return () => {
    const idx = registry.findIndex(r => r.id === item.id);
    if (idx >= 0) registry.splice(idx, 1);
  };
}

function hideMenu() {
  try { menuEl?.remove(); } catch {}
  menuEl = null;
  for (const off of cleanup.splice(0)) { try { off(); } catch {} }
}

function pickTextareaContext(target) {
  const taCandidate = (target?.closest?.('textarea.block-input') || document.activeElement);
  const ta = (taCandidate && taCandidate.matches && taCandidate.matches('textarea.block-input')) ? taCandidate : null;
  if (!ta || typeof ta.selectionStart !== 'number' || typeof ta.selectionEnd !== 'number') return null;
  const start = ta.selectionStart ?? 0;
  const end = ta.selectionEnd ?? 0;
  if (!(end > start)) return null;
  const selected = String((ta.value || '').slice(start, end) || '');
  const trimmed = selected.trim();
  if (!trimmed || /\n/.test(trimmed) || trimmed.length > 200) return null;
  // Robust blockId derivation for textarea
  let blockId = '';
  try { blockId = ta?.dataset?.blockId || ''; } catch {}
  if (!blockId) {
    const blockEl = ta.closest('[data-block-id]');
    blockId = blockEl?.getAttribute?.('data-block-id') || '';
  }
  if (!blockId) {
    const legacy = ta.closest('[data-src-block]');
    blockId = legacy?.getAttribute?.('data-src-block') || '';
  }
  return { kind: 'textarea', ta, start, end, selected, blockId };
}

function pickViewSelectionContext() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const s = String(sel.toString() || '').trim();
  if (!s || s.length > 200 || /\n/.test(s)) return null;
  const anchor = sel.anchorNode;
  const parentEl = anchor?.nodeType === 3 ? anchor.parentElement : anchor;
  const blockEl = parentEl?.closest?.('[data-block-id]');
  const blockId = blockEl?.getAttribute?.('data-block-id') || '';
  if (!blockId) return null;
  // Detect when selection is inside a rich editor contentEditable
  let editableEl = null;
  try {
    editableEl = parentEl?.closest?.('[contenteditable="true"], [contenteditable="plaintext-only"]') || null;
  } catch {}
  let range = null;
  try {
    if (editableEl) range = sel.getRangeAt(0).cloneRange();
  } catch {}
  return { kind: 'view', blockId, text: s, ...(editableEl ? { editableEl } : {}), ...(range ? { range } : {}) };
}

// Exported helper for keyboard-driven selection actions (inline comments, etc.)
export function getSelectionContextForInlineActions() {
  // Prefer textarea selection if any
  const taCtx = pickTextareaContext(document.activeElement);
  if (taCtx) return taCtx;
  // Fallback to view selection (non-empty)
  const view = pickViewSelectionContext();
  if (view) return view;
  // As a last resort, if right now there is no non-empty selection, return null
  return null;
}

function renderMenu(x, y, items, ctx) {
  hideMenu();
  if (!items.length) return;
  const m = document.createElement('div');
  m.className = 'selection-ctx';
  m.style.position = 'fixed';
  m.style.zIndex = '1001';
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;
  m.style.background = 'var(--panel)';
  m.style.border = '1px solid var(--border)';
  m.style.borderRadius = '8px';
  m.style.boxShadow = 'var(--shadow-2, 0 8px 30px rgba(0,0,0,0.32))';
  m.style.padding = '6px';
  m.style.minWidth = '220px';

  items.forEach((def, idx) => {
    if (idx > 0) {
      const sep = document.createElement('div');
      sep.style.margin = '4px 0';
      sep.style.borderTop = '1px solid var(--border)';
      m.appendChild(sep);
    }
    const enabled = def.isEnabled(ctx);
    const row = document.createElement('div');
    row.textContent = def.label;
    row.style.padding = '6px 8px';
    row.style.cursor = enabled ? 'pointer' : 'not-allowed';
    row.style.opacity = enabled ? '1' : '0.6';
    row.addEventListener('mouseenter', () => { if (enabled) row.style.background = 'var(--surface-2, rgba(255,255,255,0.06))'; });
    row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
    row.addEventListener('click', async () => {
      if (!enabled) return;
      try { await def.onClick(ctx); } finally { hideMenu(); }
    });
    m.appendChild(row);
  });

  document.body.appendChild(m);
  menuEl = m;
  const onMouseDown = (ev) => { if (!m.contains(ev.target)) hideMenu(); };
  const onClick = (ev) => { if (!m.contains(ev.target)) hideMenu(); };
  const onKey = (ev) => { if (ev.key === 'Escape') hideMenu(); };
  const onScroll = () => hideMenu();
  const onResize = () => hideMenu();
  const onBlur = () => hideMenu();
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', onResize, true);
  window.addEventListener('blur', onBlur, true);
  cleanup.push(() => document.removeEventListener('mousedown', onMouseDown, true));
  cleanup.push(() => document.removeEventListener('click', onClick, true));
  cleanup.push(() => document.removeEventListener('keydown', onKey, true));
  cleanup.push(() => window.removeEventListener('scroll', onScroll, true));
  cleanup.push(() => window.removeEventListener('resize', onResize, true));
  cleanup.push(() => window.removeEventListener('blur', onBlur, true));
}

// Single global listener
document.addEventListener('contextmenu', (e) => {
  try { hideMenu(); } catch {}
  if (!registry.length) return; // nothing registered

  // Prefer textarea context if selection is inside one
  const taCtx = pickTextareaContext(e.target);
  let ctx = taCtx;
  if (!ctx) ctx = pickViewSelectionContext();
  // If no text selection, still allow context for existing inline comment node
  if (!ctx) {
    try {
      const el = e.target?.closest?.('.inline-comment');
      if (el) {
        const blockEl = el.closest('[data-block-id]');
        const blockId = blockEl?.getAttribute?.('data-block-id') || '';
        const commentId = el.getAttribute('data-comment-id') || el.dataset?.commentId || '';
        ctx = { kind: 'inline-comment', el, blockId, commentId, label: el.textContent || '' };
      }
    } catch {}
  }
  if (!ctx) return; // let native menu show

  // Build items list for this context
  const items = registry.filter(r => {
    try { return !!r.isVisible(ctx); } catch { return false; }
  });
  if (!items.length) return; // nothing to show

  e.preventDefault();
  e.stopPropagation();
  renderMenu(e.clientX, e.clientY, items, ctx);
});
