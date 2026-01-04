// --- Spell Details Modal logic ---
async function openSpellDetails(slug) {
  if (!slug) return;
  const modal = getSpellDetailsModal();
  if (!modal) return;
  const titleEl = modal.querySelector('#open5eSpellDetailsTitle');
  const bodyEl = modal.querySelector('#open5eSpellDetailsBody');
  const closeBtn = modal.querySelector('[data-close], .btn, button');
  // Show loading state
  if (titleEl) titleEl.textContent = 'Loading...';
  if (bodyEl) bodyEl.innerHTML = '<div style="padding:16px;">Loading spell details...</div>';
  modal.style.display = 'block';
  modal.classList.add('open');
  let data = cache.get(slug);
  if (!data) {
    try {
      data = await fetchJson(`/api/open5e/spells/${encodeURIComponent(slug)}/`);
      cache.set(slug, data || {});
    } catch {
      if (titleEl) titleEl.textContent = 'Error';
      if (bodyEl) bodyEl.innerHTML = '<div style="padding:16px; color:var(--danger,red);">Failed to load spell details.</div>';
      return;
    }
  }
  // Render details
  if (titleEl) titleEl.textContent = data.name || 'Spell';
  if (bodyEl) bodyEl.innerHTML = renderSpellDetails(data);
  // Focus close button for accessibility
  setTimeout(() => { try { closeBtn?.focus(); } catch {} }, 0);
}

// Render full spell details safely
function renderSpellDetails(spell) {
  if (!spell) return '';
  const escape = escapeHtml;
  const parts = [];
  // Title and subheader
  const name = spell.name || '';
  const level = (spell.level_int != null ? spell.level_int : spell.level) ?? '';
  const school = spell.school || '';
  const subheader = (level === 0 ? 'Cantrip' : (level !== '' ? `Level ${level}` : '')) + (school ? ` • ${school}` : '');
  parts.push(`<div style="font-weight:700; font-size:1.3em; margin-bottom:2px;">${escape(String(name))}</div>`);
  if (subheader.trim()) parts.push(`<div class="meta" style="margin-bottom:8px;">${escape(subheader.trim())}</div>`);
  // Metadata grid
  const meta = [];
  if (spell.casting_time || spell.castingTime) meta.push(['Casting Time', spell.casting_time || spell.castingTime]);
  if (spell.range) meta.push(['Range', spell.range]);
  if (spell.duration) meta.push(['Duration', spell.duration + (spell.concentration ? ' (Concentration)' : '')]);
  if (spell.components) meta.push(['Components', spell.components]);
  if (spell.material) meta.push(['Material', spell.material]);
  if (spell.ritual) meta.push(['Ritual', spell.ritual ? 'Yes' : 'No']);
  if (spell.attack_type) meta.push(['Attack/Save', spell.attack_type]);
  if (meta.length) {
    parts.push('<dl class="o5e-spell-details-meta" style="margin-bottom:10px;">');
    for (const [k, v] of meta) {
      parts.push(`<dt>${escape(String(k))}</dt><dd>${escape(String(v))}</dd>`);
    }
    parts.push('</dl>');
  }
  // Description
  let desc = spell.desc || spell.description || '';
  desc = escape(String(desc)).replace(/\n/g, '<br>');
  if (desc) parts.push(`<div class="o5e-spell-details-body">${desc}</div>`);
  // Higher level
  if (spell.higher_level) {
    let higher = escape(String(spell.higher_level)).replace(/\n/g, '<br>');
    parts.push(`<div class="o5e-spell-details-body" style="margin-top:10px;"><strong>At Higher Levels:</strong> ${higher}</div>`);
  }
  return parts.join('');
}
// --- Spell Details Modal ---
function getSpellDetailsModal() { return document.getElementById('open5eSpellDetailsModal'); }

// Delegated click handler for .o5e-spell
document.addEventListener('click', function(e) {
  const target = e.target;
  const el = target?.closest?.('.o5e-spell');
  if (!el) return;
  // Only handle in view mode (not edit mode)
  if (document.body.classList.contains('editing')) return;
  const slug = el.dataset.o5eSlug || el.getAttribute('data-o5e-slug') || '';
  if (!slug) return;
  e.preventDefault();
  e.stopPropagation();
  // Open Open5e site in a new tab; fall back to details modal if blocked
  try { window.open(`https://open5e.com/spells/${encodeURIComponent(slug)}/`, '_blank', 'noopener'); } catch {}
  try { setTimeout(() => openSpellDetails(slug), 0); } catch {}
});
import { fetchJson } from '../lib/http.js';
import { $, $$, escapeHtml } from '../lib/dom.js';
import { getCurrentPageBlocks, updateCurrentBlocks } from '../lib/pageStore.js';
import { apiPatchBlock } from '../blocks/api.js';
import { renderBlocksReadOnly } from '../blocks/readOnly.js';
import { registerSelectionMenuItem } from './selectionContextMenu.js';
import { sanitizeRichHtml, plainTextFromHtmlContainer } from '../lib/sanitize.js';
import { debouncePatch, flushDebouncedPatches, patchBlockNow } from '../blocks/edit/state.js';

// Single shared hovercard
let hoverEl = null;
let hoverTimer = null;
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

// Selection context menu is now shared via selectionContextMenu.js

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
  if (window.__DEV__) try { console.debug('[o5e] commit', st?.kind); } catch {}
  try {
    if (st?.kind === 'edit' && st?.textarea) {
      // Insert into textarea using stored start/end and selected text
      const ta = st.textarea;
      const start = st.start ?? 0;
      const end = st.end ?? 0;
      const token = `[[o5e:spell:${sel.slug}|${st.selectedText || ''}]]`;
      const before = (ta.value || '').slice(0, start);
      const after = (ta.value || '').slice(end);
      ta.value = before + token + after;
      ta.focus();
      const pos = start + token.length;
      try { ta.setSelectionRange(pos, pos); } catch {}
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      // If this block also has rich HTML, mirror the replacement there to keep view consistent
      try {
        const blockId = st.blockId || ta?.dataset?.blockId || ta.closest?.('[data-block-id]')?.getAttribute?.('data-block-id') || '';
        if (blockId) {
          const blk = getCurrentPageBlocks().find(b => String(b.id) === String(blockId));
          const props = blk ? JSON.parse(blk.propsJson || '{}') : {};
          const orig = String(st.selectedText || '').trim();
          if (props && typeof props.html === 'string' && props.html && orig) {
            try {
              const tmp = document.createElement('div');
              tmp.innerHTML = String(props.html);
              const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
              let tn; let replaced = false;
              while ((tn = walker.nextNode())) {
                if (replaced) break;
                const s = tn.nodeValue || '';
                const j = s.indexOf(orig);
                if (j >= 0) { tn.nodeValue = s.slice(0, j) + token + s.slice(j + orig.length); replaced = true; }
              }
              if (replaced) {
                const newHtml = tmp.innerHTML;
                await apiPatchBlock(blockId, { props: { ...(props || {}), html: newHtml } });
                updateCurrentBlocks(b => String(b.id) === String(blockId) ? { ...b, propsJson: JSON.stringify({ ...(props || {}), html: newHtml }) } : b);
              }
            } catch {}
          }
        }
      } catch {}
    } else if (st?.kind === 'view' && st.blockId) {
      const blockId = st.blockId;
      // Rich selection inside editor: replace DOM selection and persist html+text
      if (st.editableEl && st.range) {
        try {
          const editableEl = st.editableEl;
          const range = st.range;
          const label = String(st.selectedText || sel.item?.name || sel.slug || '').trim();
          const token = `[[o5e:spell:${sel.slug}|${label}]]`;
          range.deleteContents();
          range.insertNode(document.createTextNode(token));
          try {
            const selObj = window.getSelection();
            selObj?.removeAllRanges();
            const endRange = document.createRange();
            endRange.selectNodeContents(editableEl);
            endRange.collapse(false);
            selObj?.addRange(endRange);
          } catch {}
          const html = sanitizeRichHtml(editableEl.innerHTML);
          const text = plainTextFromHtmlContainer(editableEl);
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
          if (typeof patchBlockNow === 'function') {
            await patchBlockNow(blockId, { content: { text }, props: { html } });
          } else {
            debouncePatch(blockId, { content: { text }, props: { html } }, 0);
            await flushDebouncedPatches();
          }
        } catch {}
      } else {
        const blk = getCurrentPageBlocks().find(b => String(b.id) === String(blockId));
        const content = JSON.parse(blk?.contentJson || '{}');
        const props = JSON.parse(blk?.propsJson || '{}');
        const raw = String(content?.text || '');
        const term = String(st.selectedText || '').trim();
        const occIdx = raw.indexOf(term);
        if (occIdx < 0) throw new Error('Selection not found in block');
        if (raw.indexOf(term, occIdx + term.length) !== -1) {
          alert('Term appears multiple times in this block. Edit to place precisely.');
          return;
        }
        const label = term || String(sel.item?.name || sel.slug);
        const token = `[[o5e:spell:${sel.slug}|${label}]]`;
        const nextText = raw.slice(0, occIdx) + token + raw.slice(occIdx + term.length);
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
              if (j >= 0) { tn.nodeValue = s.slice(0, j) + token + s.slice(j + term.length); replaced = true; }
            }
            nextHtml = tmp.innerHTML;
          }
        } catch {}
        await apiPatchBlock(blockId, { content: { ...(content || {}), text: nextText }, ...(nextHtml != null ? { props: { ...(props || {}), html: nextHtml } } : {}) });
        updateCurrentBlocks(b => b.id === blockId ? { ...b, contentJson: JSON.stringify({ ...(content || {}), text: nextText }), ...(nextHtml != null ? { propsJson: JSON.stringify({ ...(props || {}), html: nextHtml }) } : {}) } : b);
        rerenderReadOnlyNow();
      }
    }
  } catch (e) {
    console.error('[o5e] link commit failed', e);
    alert('Failed to insert link.');
  } finally {
    try { modal.style.display = 'none'; } catch {}
  }
}

function openSpellModalWithContext(info) {
  const modal = getSpellModal();
  if (!modal) return;
  setModalState(modal, { kind: info.kind, textarea: info.textarea || null, start: info.start, end: info.end, blockId: info.blockId || null, selectedText: info.text || '', editableEl: info.editableEl || null, range: info.range || null });
  const input = modal.querySelector('input[name="open5eSpellQuery"]');
  const allCb = modal.querySelector('input[name="open5eSpellAllSources"]');
  const queryText = info.text || '';
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
  wireModal();
  // Register selection menu item using shared menu
  try {
    registerSelectionMenuItem({
      id: 'o5e-spell-search',
      label: 'Search Open5e (Spell)…',
      order: 10,
      isVisible: (ctx) => (
        (ctx.kind === 'textarea' && String(ctx.selected || '').trim())
        || (ctx.kind === 'view' && String(ctx.text || '').trim())
      ),
      isEnabled: (ctx) => (
        (ctx.kind === 'textarea' && String(ctx.selected || '').trim())
        || (ctx.kind === 'view' && String(ctx.text || '').trim())
      ),
      onClick: (ctx) => {
        if (ctx.kind === 'textarea') {
          openSpellModalWithContext({ kind: 'edit', textarea: ctx.ta, start: ctx.start, end: ctx.end, text: String(ctx.selected || ''), blockId: ctx.blockId || (ctx.ta?.dataset?.blockId || '') });
        } else if (ctx.kind === 'view') {
          openSpellModalWithContext({ kind: 'view', blockId: ctx.blockId, text: String(ctx.text || ''), editableEl: ctx.editableEl || null, range: ctx.range || null });
        }
      }
    });
  } catch {}
}
