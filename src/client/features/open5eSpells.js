import { fetchJson } from '../lib/http.js';
import { $, $$, escapeHtml } from '../lib/dom.js';
import { getCurrentPageBlocks, updateCurrentBlocks } from '../lib/pageStore.js';
import { apiPatchBlock } from '../blocks/api.js';
import { renderBlocksReadOnly } from '../blocks/readOnly.js';

// Single shared hovercard
let hoverEl = null;
let hoverTimer = null;
let linkCtx = null; // persistent link context across modal lifecycle
const cache = new Map(); // slug -> data

function ensureHover() {
  if (hoverEl) return hoverEl;
  const el = document.createElement('div');
  el.className = 'hovercard o5e-hovercard';
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
  const pad = 8;
  let top = r.bottom + window.scrollY + pad;
  let left = r.left + window.scrollX;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const maxW = Math.min(340, Math.max(260, vw - 24));
  el.style.maxWidth = `${maxW}px`;
  const estW = Math.min(maxW, Math.max(260, r.width + 120));
  if (left + estW > vw - 12) left = Math.max(12, vw - 12 - estW);
  // After content is set/displayed, we can measure true size
  const h = el.offsetHeight || 220; // fallback estimate
  // If bottom overflows viewport, show above the target
  const bottomY = (top + h) - window.scrollY;
  if (bottomY > vh - 12) {
    const above = (r.top + window.scrollY) - pad - h;
    // Avoid going off the top too
    top = Math.max(12 + window.scrollY, above);
  }
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function renderSpellHover(data) {
  const parts = [];
  const name = data.name || '';
  const level = (data.level_int != null ? data.level_int : data.level) ?? '';
  const school = data.school || '';
  const meta = [];
  if (level !== '' && level !== null) meta.push(`${level === 0 ? 'Cantrip' : `Level ${level}`}${school ? ` • ${school}` : ''}`);
  const casting = data.casting_time || data.castingTime || '';
  const range = data.range || '';
  const duration = data.duration || '';
  const components = data.components || '';
  const desc = (data.desc || data.description || '').replace(/\s+/g, ' ').trim();
  const shortDesc = desc.length > 420 ? desc.slice(0, 420) + '…' : desc;
  parts.push(`<div style="font-weight:700; font-size:14px; margin-bottom:2px;">${escapeHtml(String(name))}</div>`);
  if (meta.length) parts.push(`<div class="meta" style="margin-bottom:6px;">${escapeHtml(meta.join(' • '))}</div>`);
  const rows = [];
  if (casting) rows.push(`<div><strong>Casting:</strong> ${escapeHtml(String(casting))}</div>`);
  if (range) rows.push(`<div><strong>Range:</strong> ${escapeHtml(String(range))}</div>`);
  if (duration) rows.push(`<div><strong>Duration:</strong> ${escapeHtml(String(duration))}</div>`);
  if (components) rows.push(`<div><strong>Components:</strong> ${escapeHtml(String(components))}</div>`);
  if (rows.length) parts.push(`<div style="font-size:12px; display:grid; gap:2px; margin-bottom:6px;">${rows.join('')}</div>`);
  if (shortDesc) parts.push(`<div style="font-size:12px; white-space:normal;">${escapeHtml(String(shortDesc))}</div>`);
  return parts.join('');
}

function installHoverBehavior() {
  document.addEventListener('pointerover', (e) => {
    const el = e.target?.closest?.('.o5e-spell');
    if (!el) return;
    const slug = (
      el.dataset.o5eSlug ||
      el.getAttribute('data-o5e-slug') ||
      el.dataset.slug ||
      ''
    );
    if (window.__DEV__) try { console.debug('[o5e] hover', { slug }); } catch {}
    if (!slug) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(async () => {
      try {
        const hc = ensureHover();
        let data = cache.get(slug);
        if (!data) {
          data = await fetchJson(`/api/open5e/spells/${encodeURIComponent(slug)}/`);
          cache.set(slug, data || {});
        }
        hc.innerHTML = renderSpellHover(data || {});
        hc.style.display = 'block';
        positionHover(el);
      } catch {}
    }, 180);
  });
  document.addEventListener('pointerout', (e) => {
    const el = e.target?.closest?.('.o5e-spell');
    if (!el) return;
    clearTimeout(hoverTimer);
    hideHover();
  });
  window.addEventListener('scroll', hideHover, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideHover(); });
}

// Context menu for creating spell links
let ctxMenu = null;
function hideCtx() { if (ctxMenu) ctxMenu.remove(); ctxMenu = null; }

function showCtx(x, y, onPick) {
  hideCtx();
  const m = document.createElement('div');
  m.className = 'o5e-ctx';
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
  const item = document.createElement('div');
  item.textContent = 'Search Open5e (Spell)…';
  item.style.padding = '6px 8px';
  item.style.cursor = 'pointer';
  item.addEventListener('mouseenter', () => { item.style.background = 'var(--surface-2, rgba(255,255,255,0.06))'; });
  item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
  item.addEventListener('click', () => { try { onPick(); } finally { hideCtx(); } });
  m.appendChild(item);
  document.body.appendChild(m);
  ctxMenu = m;
  const onDoc = (ev) => { if (!m.contains(ev.target)) hideCtx(); };
  setTimeout(() => document.addEventListener('click', onDoc, { once: true }), 0);
}

function selectionInfoFromEvent(e) {
  const t = e.target;
  // Edit mode: textarea
  const ta = t?.closest?.('textarea.block-input');
  if (ta && typeof ta.selectionStart === 'number' && typeof ta.selectionEnd === 'number') {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (end > start) {
      const raw = ta.value.slice(start, end);
      const text = String(raw || '').trim();
      if (text && text.length <= 60 && !/\n/.test(text)) {
        return { kind: 'edit', textarea: ta, start, end, text };
      }
    }
    return null;
  }
  // View mode: window selection
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const s = String(sel.toString() || '').trim();
  if (!s || s.length > 60 || /\n/.test(s)) return null;
  const anchor = sel.anchorNode;
  const parentEl = anchor?.nodeType === 3 ? anchor.parentElement : anchor;
  const blockEl = parentEl?.closest?.('[data-block-id]');
  const blockId = blockEl?.getAttribute?.('data-block-id') || '';
  if (!blockId) return null;
  return { kind: 'view', blockId, text: s };
}

function installContextMenu() {
  document.addEventListener('contextmenu', (e) => {
    try { hideCtx(); } catch {}
    linkCtx = null;
    // Prefer textarea selection if present/active
    const ta = (e.target?.closest?.('textarea.block-input') || document.activeElement);
    if (ta && ta.matches?.('textarea.block-input')) {
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      const selected = String((ta.value || '').slice(start, end) || '');
      if (!selected.trim()) return; // let native menu show
      linkCtx = { kind: 'textarea', ta, start, end, selected };
      e.preventDefault();
      e.stopPropagation();
      showCtx(e.clientX, e.clientY, () => openSpellModalWithContext({ kind: 'edit', text: selected }));
      return;
    }
    // View mode fallback
    const info = selectionInfoFromEvent(e);
    if (!info) return; // Let native menu show
    linkCtx = { kind: 'view', blockId: info.blockId, selectedText: info.text };
    e.preventDefault();
    e.stopPropagation();
    showCtx(e.clientX, e.clientY, () => openSpellModalWithContext(info));
  });
}

function findBlocksRoot() { return document.getElementById('pageBlocks'); }

function rerenderReadOnlyNow() {
  try {
    const root = findBlocksRoot();
    if (!root) return;
    renderBlocksReadOnly(root, getCurrentPageBlocks());
  } catch {}
}

// Modal wiring
function getSpellModal() { return document.getElementById('open5eSpellModal'); }

function setModalState(modal, patch) {
  modal.__o5eState = { ...(modal.__o5eState || {}), ...(patch || {}) };
}

function getModalState(modal) { return modal.__o5eState || {}; }

async function doSearch(modal) {
  const st = getModalState(modal);
  const q = (st.query || '').trim();
  const resultsEl = modal.querySelector('.o5eSpellResults');
  const hintEl = modal.querySelector('.o5eSpellHint');
  const allSources = !!st.allSources;
  resultsEl.innerHTML = '';
  if (!q) { hintEl.textContent = ''; return; }
  let url = `/api/open5e/spells/?search=${encodeURIComponent(q)}`;
  if (!allSources) url += `&document__slug=wotc-srd`;
  try {
    const res = await fetchJson(url);
    const arr = Array.isArray(res?.results) ? res.results : (Array.isArray(res) ? res : []);
    if (!arr.length && !allSources) {
      hintEl.textContent = 'No SRD match — try “Search all sources”.';
    } else {
      hintEl.textContent = '';
    }
    const frag = document.createDocumentFragment();
    arr.slice(0, 40).forEach((it) => {
      const row = document.createElement('div');
      row.className = 'o5eSpellRow';
      row.setAttribute('data-slug', it.slug || '');
      row.setAttribute('role', 'option');
      row.style.padding = '6px 8px';
      row.style.borderRadius = '8px';
      row.style.cursor = 'pointer';
      const lvl = (it.level_int != null ? it.level_int : it.level) ?? '';
      const lvlText = (lvl === 0 ? 'Cantrip' : (lvl !== '' ? `Level ${lvl}` : '')).trim();
      const parts = [escapeHtml(String(it.name || ''))];
      const meta = [lvlText, it.school].filter(Boolean).join(' • ');
      const src = it.document__title ? ` (${escapeHtml(String(it.document__title))})` : '';
      row.innerHTML = `<div style="font-weight:700;">${parts.join('')}</div>
        <div style="font-size:12px; color: var(--muted);">${escapeHtml(meta)}${src}</div>`;
      row.addEventListener('mouseenter', () => {
        resultsEl.querySelectorAll('.o5eSpellRow').forEach(n => n.classList.remove('hover'));
        row.classList.add('hover');
      });
      row.addEventListener('click', () => selectResult(modal, { slug: it.slug, item: it }));
      row.addEventListener('dblclick', () => commitLink(modal));
      frag.appendChild(row);
    });
    resultsEl.appendChild(frag);
    // Select first by default
    const first = resultsEl.querySelector('.o5eSpellRow');
    if (first) first.click();
  } catch (e) {
    resultsEl.innerHTML = '';
    hintEl.textContent = 'Search failed.';
  }
}

function selectResult(modal, sel) {
  setModalState(modal, { selection: sel });
  const btn = modal.querySelector('.modal-confirm');
  if (btn) btn.disabled = !sel;
  // Focus selected row visually
  const resultsEl = modal.querySelector('.o5eSpellResults');
  resultsEl?.querySelectorAll('.o5eSpellRow').forEach(n => n.classList.remove('is-selected'));
  if (sel?.slug) {
    const node = resultsEl?.querySelector(`.o5eSpellRow[data-slug="${CSS.escape(sel.slug)}"]`);
    if (node) node.classList.add('is-selected');
  }
  // Optional preview
  const prev = modal.querySelector('.o5eSpellPreview');
  if (prev) {
    const it = sel?.item || {};
    prev.innerHTML = renderSpellHover(it || {});
  }
}

async function commitLink(modal) {
  const st = getModalState(modal);
  const sel = st.selection;
  if (!sel?.slug) return;
  if (window.__DEV__) try { console.debug('[o5e] commit', linkCtx?.kind); } catch {}
  try {
    if (linkCtx?.kind === 'textarea' && linkCtx?.ta) {
      // Insert into textarea using stored start/end and selected text
      const ta = linkCtx.ta;
      const start = linkCtx.start ?? 0;
      const end = linkCtx.end ?? 0;
      const token = `[[o5e:spell:${sel.slug}|${linkCtx.selected}]]`;
      const before = (ta.value || '').slice(0, start);
      const after = (ta.value || '').slice(end);
      ta.value = before + token + after;
      ta.focus();
      const pos = start + token.length;
      try { ta.setSelectionRange(pos, pos); } catch {}
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (linkCtx?.kind === 'view' && st.blockId) {
      const blk = getCurrentPageBlocks().find(b => String(b.id) === String(st.blockId));
      const content = JSON.parse(blk?.contentJson || '{}');
      const raw = String(content?.text || '');
      const term = String(linkCtx?.selectedText || st.selectedText || '').trim();
      const occIdx = raw.indexOf(term);
      if (occIdx < 0) throw new Error('Selection not found in block');
      // Ensure occurs exactly once
      if (raw.indexOf(term, occIdx + term.length) !== -1) {
        alert('Term appears multiple times in this block. Edit to place precisely.');
        return;
      }
      const label = term || String(sel.item?.name || sel.slug);
      const token = `[[o5e:spell:${sel.slug}|${label}]]`;
      const nextText = raw.slice(0, occIdx) + token + raw.slice(occIdx + term.length);
      await apiPatchBlock(st.blockId, { content: { ...(content || {}), text: nextText } });
      updateCurrentBlocks(b => b.id === st.blockId ? { ...b, contentJson: JSON.stringify({ ...(content || {}), text: nextText }) } : b);
      rerenderReadOnlyNow();
    }
  } catch (e) {
    console.error('[o5e] link commit failed', e);
    alert('Failed to insert link.');
  } finally {
    try { modal.style.display = 'none'; } catch {}
    linkCtx = null;
  }
}

function openSpellModalWithContext(info) {
  const modal = getSpellModal();
  if (!modal) return;
  setModalState(modal, { kind: info.kind, textarea: info.textarea || null, start: info.start, end: info.end, blockId: info.blockId || null, selectedText: info.text || '' });
  const input = modal.querySelector('input[name="open5eSpellQuery"]');
  const allCb = modal.querySelector('input[name="open5eSpellAllSources"]');
  const queryText = (linkCtx?.kind === 'textarea' ? linkCtx.selected : info.text) || '';
  if (input) input.value = queryText;
  setModalState(modal, { query: queryText, allSources: !!allCb?.checked, selection: null });
  const btn = modal.querySelector('.modal-confirm');
  if (btn) btn.disabled = true;
  modal.style.display = 'block';
  setTimeout(() => { try { input?.focus(); input?.select(); } catch {} void doSearch(modal); }, 0);
}

function wireModal() {
  const modal = getSpellModal();
  if (!modal) return;
  const input = modal.querySelector('input[name="open5eSpellQuery"]');
  const allCb = modal.querySelector('input[name="open5eSpellAllSources"]');
  const btnCancel = modal.querySelector('.modal-cancel');
  const btnLink = modal.querySelector('.modal-confirm');
  let timer = null;
  input?.addEventListener('input', () => {
    setModalState(modal, { query: input.value });
    clearTimeout(timer);
    timer = setTimeout(() => void doSearch(modal), 160);
  });
  allCb?.addEventListener('change', () => {
    setModalState(modal, { allSources: !!allCb.checked });
    void doSearch(modal);
  });
  btnCancel?.addEventListener('click', () => { modal.style.display = 'none'; });
  btnLink?.addEventListener('click', () => commitLink(modal));
}

export function installOpen5eSpellFeature() {
  ensureHover();
  installHoverBehavior();
  installContextMenu();
  wireModal();
}
