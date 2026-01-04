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

// Delegated click handler for .o5e-link (and legacy .o5e-spell)
import { buildOpenUrl, buildApiPath, fetchOpen5e, searchOpen5e, normalizeO5eType, getOpen5eResource } from './open5eCore.js';
document.addEventListener('click', function(e) {
  const target = e.target;
  const el = target?.closest?.('.o5e-link, .o5e-spell');
  if (!el) return;
  // Handle in both view and edit modes; modal-only action
  const slug = el.dataset.o5eSlug || el.getAttribute('data-o5e-slug') || '';
  const type = normalizeO5eType(el.dataset.o5eType || el.getAttribute('data-o5e-type') || 'spell');
  if (!slug) return;
  // Modifier: cmd/ctrl-click bypasses modal to open site
  const meta = e.metaKey || e.ctrlKey;
  if (meta) {
    e.preventDefault();
    e.stopPropagation();
    try { window.open(buildOpenUrl(type, slug), '_blank', 'noopener'); } catch {}
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  // Default: open link modal for any Open5e type
  try { void openOpen5eLinkModal({ type, slug }); } catch {}
});
import { fetchJson } from '../lib/http.js';
import { $, $$, escapeHtml } from '../lib/dom.js';
import { getCurrentPageBlocks, updateCurrentBlocks } from '../lib/pageStore.js';
import { apiPatchBlock } from '../blocks/api.js';
import { renderBlocksReadOnly } from '../blocks/readOnly.js';
import { registerSelectionMenuItem } from './selectionContextMenu.js';
import { sanitizeRichHtml, plainTextFromHtmlContainer } from '../lib/sanitize.js';
import { debouncePatch, flushDebouncedPatches, patchBlockNow } from '../blocks/edit/state.js';
import { buildWikiTextNodes } from './wikiLinks.js';

// Single shared hovercard
let hoverEl = null;
let hoverTimer = null;
const cache = new Map(); // key -> data (type:slug)

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

function renderCreatureHover(data) {
  const esc = escapeHtml;
  const parts = [];
  const name = data.name || '';
  const type = data.type || '';
  const size = data.size || '';
  const alignment = data.alignment || '';
  const cr = data.cr || data.challenge_rating || '';
  const ac = data.armor_class != null ? data.armor_class : data.ac;
  const hp = data.hit_points != null ? data.hit_points : data.hp;
  const speed = typeof data.speed === 'string' ? data.speed : (data.speed_json || data.speed_jsonb || '');
  parts.push(`<div style=\"font-weight:700; font-size:14px; margin-bottom:2px;\">${esc(String(name))}</div>`);
  const meta = [size, type, alignment].filter(Boolean).join(' • ');
  const crPart = cr ? `CR ${esc(String(cr))}` : '';
  if (meta || crPart) parts.push(`<div class=\"meta\" style=\"margin-bottom:6px;\">${esc(meta)}${meta && crPart ? ' • ' : ''}${crPart}</div>`);
  const rows = [];
  if (ac != null) rows.push(`<div><strong>AC:</strong> ${esc(String(ac))}</div>`);
  if (hp != null) rows.push(`<div><strong>HP:</strong> ${esc(String(hp))}</div>`);
  if (speed) rows.push(`<div><strong>Speed:</strong> ${esc(String(speed))}</div>`);
  const abil = ['strength','dexterity','constitution','intelligence','wisdom','charisma']
    .map(k => data[k] != null ? data[k] : null);
  if (abil.some(v => v != null)) {
    const [str,dex,con,int,wis,cha] = abil.map(v => v == null ? '—' : String(v));
    rows.push(`<div><strong>STR DEX CON INT WIS CHA:</strong> ${esc(`${str} ${dex} ${con} ${int} ${wis} ${cha}`)}</div>`);
  }
  if (rows.length) parts.push(`<div style=\"font-size:12px; display:grid; gap:2px;\">${rows.join('')}</div>`);
  return parts.join('');
}

function renderConditionHover(data) {
  const esc = escapeHtml;
  const name = data.name || '';
  const desc = (data.desc || data.description || '').replace(/\s+/g, ' ').trim();
  const shortDesc = desc.length > 420 ? desc.slice(0, 420) + '…' : desc;
  return [`<div style=\"font-weight:700; font-size:14px; margin-bottom:2px;\">${esc(String(name))}</div>`,
          shortDesc ? `<div style=\"font-size:12px; white-space:normal;\">${esc(String(shortDesc))}</div>` : ''
  ].filter(Boolean).join('');
}

function renderItemHover(data) {
  const esc = escapeHtml;
  const name = data.name || '';
  const t = data.type || data.category || '';
  const rarity = data.rarity || '';
  const attune = data.requires_attunement ? 'Requires Attunement' : '';
  const desc = (data.desc || data.description || '').replace(/\s+/g, ' ').trim();
  const shortDesc = desc.length > 420 ? desc.slice(0, 420) + '…' : desc;
  const meta = [t, rarity, attune].filter(Boolean).join(' • ');
  const parts = [`<div style=\"font-weight:700; font-size:14px; margin-bottom:2px;\">${esc(String(name))}</div>`];
  if (meta) parts.push(`<div class=\"meta\" style=\"margin-bottom:6px;\">${esc(meta)}</div>`);
  if (shortDesc) parts.push(`<div style=\"font-size:12px; white-space:normal;\">${esc(String(shortDesc))}</div>`);
  return parts.join('');
}

function installHoverBehavior() {
  document.addEventListener('pointerover', (e) => {
    const el = e.target?.closest?.('.o5e-link, .o5e-spell');
    if (!el) return;
    const slug = (
      el.dataset.o5eSlug ||
      el.getAttribute('data-o5e-slug') ||
      el.dataset.slug ||
      ''
    );
    const typeAttr = el.dataset.o5eType || el.getAttribute('data-o5e-type') || 'spell';
    const type = normalizeO5eType(typeAttr);
    if (window.__DEV__) try { console.debug('[o5e] hover', { type, slug }); } catch {}
    if (!slug) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(async () => {
      try {
        const hc = ensureHover();
        const key = `${type}:${slug}`;
        let data = cache.get(key);
        if (!data) {
          data = await getOpen5eResource(type, slug, { ttlMs: 5 * 60 * 1000 });
          cache.set(key, data || {});
        }
        let html = '';
        if (type === 'spell') html = renderSpellHover(data || {});
        else if (type === 'creature') html = renderCreatureHover(data || {});
        else if (type === 'condition') html = renderConditionHover(data || {});
        else if (type === 'item' || type === 'weapon' || type === 'armor') html = renderItemHover(data || {});
        else html = `<div style=\"font-size:12px;\">Unsupported Open5e type.</div>`;
        hc.innerHTML = html || '';
        hc.style.display = 'block';
        positionHover(el);
      } catch (err) {
        const hc = ensureHover();
        hc.innerHTML = '<div style=\"font-size:12px; color:var(--danger,red);\">Failed to load preview.</div>';
        hc.style.display = 'block';
        positionHover(el);
      }
    }, 180);
  });
  document.addEventListener('pointerout', (e) => {
    const el = e.target?.closest?.('.o5e-link, .o5e-spell');
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
  // Generic path for non-spell types
  const __t = normalizeO5eType(st.type || 'spell');
  if (__t !== 'spell') {
    resultsEl.innerHTML = '';
    if (!q) { hintEl.textContent = ''; return; }
    try {
      const arr = await searchOpen5e(__t, q, { allSources });
      if (!arr.length && !allSources) {
        hintEl.textContent = 'No SRD match — try “Search all sources”.';
      } else {
        hintEl.textContent = '';
      }
      const frag = document.createDocumentFragment();
      arr.slice(0, 40).forEach((it) => {
        const row = document.createElement('div');
        row.className = 'o5eSpellRow';
        row.setAttribute('data-slug', it.slug || it.slug_name || '');
        row.setAttribute('role', 'option');
        row.style.padding = '6px 8px';
        row.style.borderRadius = '8px';
        row.style.cursor = 'pointer';
        const name = String(it.name || '');
        let meta = '';
        if (__t === 'creature') {
          const cr = it.cr || it.challenge_rating;
          const tp = it.type;
          meta = [tp, (cr != null ? `CR ${cr}` : '')].filter(Boolean).join(' • ');
        } else if (__t === 'condition') {
          meta = it.document__title || '';
        } else if (__t === 'item' || __t === 'weapon' || __t === 'armor') {
          const cat = it.type || it.category || '';
          const rarity = it.rarity || '';
          meta = [cat, rarity].filter(Boolean).join(' • ');
        }
        const src = it.document__title ? ` (${escapeHtml(String(it.document__title))})` : '';
        row.innerHTML = `<div style=\"font-weight:700;\">${escapeHtml(name)}</div>
          <div style=\"font-size:12px; color: var(--muted);\">${escapeHtml(meta)}${src}</div>`;
        row.addEventListener('mouseenter', () => {
          resultsEl.querySelectorAll('.o5eSpellRow').forEach(n => n.classList.remove('hover'));
          row.classList.add('hover');
        });
        row.addEventListener('click', () => selectResult(modal, { slug: (it.slug || it.slug_name || ''), item: it }));
        row.addEventListener('dblclick', () => commitLink(modal));
        frag.appendChild(row);
      });
      resultsEl.appendChild(frag);
      const first = resultsEl.querySelector('.o5eSpellRow');
      if (first) first.click();
    } catch (e) {
      resultsEl.innerHTML = '';
      hintEl.textContent = 'Search failed.';
    }
    return;
  }
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
  const btnAll = modal.querySelector('.modal-link-all');
  if (btn) btn.disabled = !sel;
  if (btnAll) btnAll.disabled = !sel;
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
    const t = normalizeO5eType(getModalState(modal).type || 'spell');
    let html = '';
    if (t === 'spell') html = renderSpellHover(it || {});
    else if (t === 'creature') html = renderCreatureHover(it || {});
    else if (t === 'condition') html = renderConditionHover(it || {});
    else if (t === 'item' || t === 'weapon' || t === 'armor') html = renderItemHover(it || {});
    prev.innerHTML = html || '';
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
      const t = normalizeO5eType(st.resourceType || st.type || 'spell');
      const token = `[[o5e:${t}:${sel.slug}|${st.selectedText || ''}]]`;
      const before = (ta.value || '').slice(0, start);
      const after = (ta.value || '').slice(end);
      ta.value = before + token + after;
      ta.focus();
      const pos = start + token.length;
      try { ta.setSelectionRange(pos, pos); } catch {}
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      // If this block also has rich HTML, mirror via normal pipeline (async; do not block UI)
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
                updateCurrentBlocks(b => String(b.id) === String(blockId) ? { ...b, propsJson: JSON.stringify({ ...(props || {}), html: newHtml }) } : b);
                try {
                  debouncePatch(blockId, { props: { html: newHtml } }, 0);
                } catch {
                  void apiPatchBlock(blockId, { props: { ...(props || {}), html: newHtml } }).catch(() => {});
                }
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
          const t = normalizeO5eType(st.resourceType || st.type || 'spell');
          const token = `[[o5e:${t}:${sel.slug}|${label}]]`;
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
          // Trigger save pipeline asynchronously (UI should not wait)
          try {
            if (typeof patchBlockNow === 'function') {
              // Fire and forget
              void patchBlockNow(blockId, { content: { text }, props: { html } });
            } else {
              debouncePatch(blockId, { content: { text }, props: { html } }, 0);
            }
          } catch {}
          // Immediately linkify tokens inside the live editable element for hover/preview
          try {
            const walker = document.createTreeWalker(editableEl, NodeFilter.SHOW_TEXT);
            const nodes = [];
            let n;
            while ((n = walker.nextNode())) {
              const s = n.nodeValue || '';
              const p = n.parentElement;
              if (!s || !p) continue;
              if (p.closest('a,code,pre,textarea,script,style')) continue;
              if (!s.includes('[[') && !s.includes('#')) continue;
              nodes.push(n);
            }
            for (const tn of nodes) {
              const frag = buildWikiTextNodes(tn.nodeValue || '', blockId);
              if (frag && tn.parentNode) tn.parentNode.replaceChild(frag, tn);
            }
          } catch {}
        } catch {}
      } else {
        // True read-only view selection: replace exactly the selected Range in the block DOM
        try {
          const blockEl = document.querySelector(`[data-block-id="${CSS.escape(String(blockId))}"]`);
          if (!blockEl || !st.range) throw new Error('Missing selection range');
          const range = st.range;
          const label = String(st.selectedText || sel.item?.name || sel.slug || '').trim();
          const t = normalizeO5eType(st.resourceType || st.type || 'spell');
          const token = `[[o5e:${t}:${sel.slug}|${label}]]`;
          // Mutate a temporary copy to compute next html/text safely
          const tmp = document.createElement('div');
          tmp.innerHTML = blockEl.innerHTML;
          // Map the live range to the temp fragment by serializing offsets via text content walk
          // Fallback: apply directly on live DOM, then read back
          try {
            range.deleteContents();
            range.insertNode(document.createTextNode(token));
          } catch {}
          const nextHtml = sanitizeRichHtml(blockEl.innerHTML);
          const nextText = plainTextFromHtmlContainer(blockEl);
          const blocks = getCurrentPageBlocks();
          const blk = blocks.find(b => String(b.id) === String(blockId));
          const content = blk ? JSON.parse(blk.contentJson || '{}') : {};
          const props = blk ? JSON.parse(blk.propsJson || '{}') : {};
          updateCurrentBlocks(b => String(b.id) === String(blockId)
            ? { ...b,
                contentJson: JSON.stringify({ ...(content || {}), text: nextText }),
                propsJson: JSON.stringify({ ...(props || {}), html: nextHtml })
              }
            : b);
          rerenderReadOnlyNow();
          try {
            if (typeof patchBlockNow === 'function') {
              void patchBlockNow(blockId, { content: { text: nextText }, props: { html: nextHtml } });
            } else {
              debouncePatch(blockId, { content: { text: nextText }, props: { html: nextHtml } }, 0);
            }
          } catch {}
        } catch (e) {
          console.error('[o5e] precise view selection failed, falling back', e);
          alert('Failed to link the selected occurrence.');
          return;
        }
      }
    }
  } catch (e) {
    console.error('[o5e] link commit failed', e);
    alert('Failed to insert link.');
  } finally {
    try { modal.style.display = 'none'; } catch {}
  }
}

function openSpellModalWithContext(info, resourceType = 'spell') {
  const modal = getSpellModal();
  if (!modal) return;
  const initType = normalizeO5eType(resourceType);
  setModalState(modal, { kind: info.kind, type: initType, resourceType: initType, textarea: info.textarea || null, start: info.start, end: info.end, blockId: info.blockId || null, selectedText: info.text || '', editableEl: info.editableEl || null, range: info.range || null });
  const input = modal.querySelector('input[name="open5eSpellQuery"]');
  const allCb = modal.querySelector('input[name="open5eSpellAllSources"]');
  const typeSel = modal.querySelector('select[name="open5eType"]');
  const queryText = info.text || '';
  if (input) input.value = queryText;
  setModalState(modal, { query: queryText, allSources: !!allCb?.checked, selection: null });
  const btn = modal.querySelector('.modal-confirm');
  if (btn) btn.disabled = true;
  // Update modal title dynamically
  try {
    const h2 = modal.querySelector('h2');
    const labels = { spell: 'Spell', creature: 'Creature', condition: 'Condition', item: 'Magic Item', weapon: 'Weapon', armor: 'Armor' };
    h2.textContent = `Link ${labels[initType] || 'Open5e'}`;
    if (typeSel) typeSel.value = initType;
    if (input) input.placeholder = `Search ${labels[initType] || 'Open5e'}…`;
  } catch {}
  modal.style.display = 'block';
  setTimeout(() => { try { input?.focus(); input?.select(); } catch {} void doSearch(modal); }, 0);
}

function wireModal() {
  const modal = getSpellModal();
  if (!modal) return;
  const input = modal.querySelector('input[name="open5eSpellQuery"]');
  const allCb = modal.querySelector('input[name="open5eSpellAllSources"]');
  const typeSel = modal.querySelector('select[name="open5eType"]');
  const btnCancel = modal.querySelector('.modal-cancel');
  const btnLink = modal.querySelector('.modal-confirm');
  const btnLinkAll = modal.querySelector('.modal-link-all');
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
  typeSel?.addEventListener('change', () => {
    const t = typeSel.value;
    setModalState(modal, { type: normalizeO5eType(t), selection: null });
    try {
      const h2 = modal.querySelector('h2');
      const labels = { spell: 'Spell', creature: 'Creature', condition: 'Condition', item: 'Magic Item', weapon: 'Weapon', armor: 'Armor' };
      if (h2) h2.textContent = `Link ${labels[normalizeO5eType(t)] || 'Open5e'}`;
      if (input) input.placeholder = `Search ${labels[normalizeO5eType(t)] || 'Open5e'}…`;
    } catch {}
    void doSearch(modal);
  });
  btnCancel?.addEventListener('click', () => { modal.style.display = 'none'; });
  btnLink?.addEventListener('click', () => commitLink(modal));
  btnLinkAll?.addEventListener('click', () => linkAllOccurrences(modal));
}

// ---- Open5e Link Modal (click on [[o5e:..]] tokens)
function getO5eLinkModal() { return document.getElementById('open5eLinkModal'); }

async function openOpen5eLinkModal({ type, slug }) {
  const modal = getO5eLinkModal();
  if (!modal) return;
  const titleEl = modal.querySelector('#open5eLinkTitle');
  const metaEl = modal.querySelector('#open5eLinkMeta');
  const sel = modal.querySelector('#o5eLinkSectionSelect');
  const btnCreate = modal.querySelector('#o5eCreatePageBtn');
  const btnJson = modal.querySelector('#o5eOpenJsonBtn');
  const btnExisting = modal.querySelector('#o5eOpenExistingBtn');
  // populate fields
  try {
    titleEl.textContent = 'Open5e';
    metaEl.textContent = '';
    btnExisting.style.display = 'none';
  } catch {}
  modal.dataset.o5eType = type;
  modal.dataset.o5eSlug = slug;
  // Prefetch from shared cache with short TTL for quick title
  try {
    const data = await getOpen5eResource(type, slug, { ttlMs: 5 * 60 * 1000 });
    if (data) {
      const name = data.name || slug;
      const sub = [];
      if (type === 'spell') {
        const level = (data.level_int != null ? data.level_int : data.level) ?? '';
        const school = data.school || '';
        if (level !== '' || school) sub.push(`${level === 0 ? 'Cantrip' : (level !== '' ? `Level ${level}` : '')}${school ? ` • ${school}` : ''}`);
      } else if (type === 'creature') {
        const cr = data.cr || data.challenge_rating || '';
        const tp = data.type || '';
        if (tp) sub.push(tp);
        if (cr) sub.push(`CR ${cr}`);
      } else if (type === 'item' || type === 'weapon' || type === 'armor') {
        const cat = data.type || data.category || '';
        const rarity = data.rarity || '';
        if (cat) sub.push(cat);
        if (rarity) sub.push(rarity);
      }
      titleEl.textContent = name;
      metaEl.textContent = sub.filter(Boolean).join(' • ');
    }
  } catch {}
  // Wire JSON button
  btnJson.onclick = () => {
    try { window.open(buildApiPath(type, slug), '_blank', 'noopener'); } catch {}
  };
  // Check for existing page by this Open5e resource
  let existing = null;
  try {
    const res = await fetchJson(`/api/open5e/local-pages?type=${encodeURIComponent(type)}&slug=${encodeURIComponent(slug)}`);
    const arr = Array.isArray(res?.pages) ? res.pages : [];
    existing = arr[0] || null;
  } catch {}
  if (existing) {
    btnExisting.style.display = '';
    btnExisting.textContent = `Open existing page`;
    btnExisting.onclick = () => { try { window.open(existing.slug ? `/p/${encodeURIComponent(existing.slug)}` : `/page/${encodeURIComponent(existing.id)}`, '_blank'); } catch {}; };
    // Hide create to avoid duplicates
    btnCreate.style.display = 'none';
  } else {
    btnExisting.style.display = 'none';
    btnCreate.style.display = '';
    btnCreate.textContent = 'Create new page';
  }
  // Wire create flow
  btnCreate.onclick = async () => {
    try {
      const t = modal.dataset.o5eType || type;
      const s = modal.dataset.o5eSlug || slug;
      const pageType = sel?.value || 'note';
      // Create page
      const data = await getOpen5eResource(t, s, { ttlMs: 5 * 60 * 1000 });
      const title = (data?.name) || s;
      const page = await fetchJson('/api/pages', { method: 'POST', body: JSON.stringify({ title, type: pageType }) });
      // Patch sheet with open5eSource metadata (+ optional snapshot placeholder)
      const apiUrl = buildApiPath(t, s);
      const docSlug = (data && (data.document__slug || data.document__slug_name || data.document__slug_field)) || null;
      const sheetPatch = { open5eSource: { type: t, slug: s, apiUrl, ...(docSlug ? { documentSlug: String(docSlug) } : {}), createdFrom: 'open5e', readonly: true } };
      try { await fetchJson(`/api/pages/${encodeURIComponent(page.id)}/sheet`, { method: 'PATCH', body: JSON.stringify(sheetPatch) }); } catch {}
      // Open page in new tab
      try { window.open(page.slug ? `/p/${encodeURIComponent(page.slug)}` : `/page/${encodeURIComponent(page.id)}`, '_blank'); } catch {}
    } catch (err) {
      console.error('[o5e] create page failed', err);
      alert('Failed to create page for this Open5e resource.');
    }
  };
  modal.style.display = 'block';
}

export function installOpen5eSpellFeature() {
  ensureHover();
  installHoverBehavior();
  wireModal();
  // Register selection menu item using shared menu
  try {
    registerSelectionMenuItem({
      id: 'o5e-search',
      label: 'Search Open5e…',
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

// ---- Link all occurrences across the page
function replaceAllInElementTextNodes(root, term, replacement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let tn; let count = 0;
  const re = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'g');
  const skipSelector = 'a,code,pre,textarea,script,style,.inline-comment';
  while ((tn = walker.nextNode())) {
    const p = tn.parentElement;
    if (!p || p.closest(skipSelector)) continue;
    const s = tn.nodeValue || '';
    if (!s) continue;
    if (re.test(s)) {
      tn.nodeValue = s.replace(re, () => { count++; return replacement; });
    }
  }
  return count;
}

function countOccurrencesInElement(root, term) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let tn; let count = 0;
  const re = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'g');
  const skipSelector = 'a,code,pre,textarea,script,style,.inline-comment';
  while ((tn = walker.nextNode())) {
    const p = tn.parentElement;
    if (!p || p.closest(skipSelector)) continue;
    const s = tn.nodeValue || '';
    if (!s) continue;
    const m = s.match(re);
    if (m) count += m.length;
  }
  return count;
}

async function linkAllOccurrences(modal) {
  const st = getModalState(modal);
  const sel = st.selection;
  if (!sel?.slug) return;
  const term = String(st.selectedText || '').trim();
  if (!term) return;
  const t = normalizeO5eType(st.resourceType || st.type || 'spell');
  const token = `[[o5e:${t}:${sel.slug}|${term}]]`;
  // Compute total occurrences across page
  const blocks = getCurrentPageBlocks();
  let total = 0;
  const previews = new Map(); // id -> { nextHtml, nextText, count }
  for (const b of blocks) {
    try {
      const content = JSON.parse(b.contentJson || '{}');
      const props = JSON.parse(b.propsJson || '{}');
      const host = document.createElement('div');
      if (props && props.html) host.innerHTML = String(props.html || ''); else host.textContent = String(content?.text || '');
      const c = countOccurrencesInElement(host, term);
      if (c > 0) {
        // Prepare preview replacement for later commit
        const host2 = host.cloneNode(true);
        const replaced = replaceAllInElementTextNodes(host2, term, token);
        const nextHtml = sanitizeRichHtml(host2.innerHTML);
        const nextText = plainTextFromHtmlContainer(host2);
        previews.set(String(b.id), { nextHtml, nextText, count: replaced });
        total += replaced;
      }
    } catch {}
  }
  if (total <= 0) {
    alert('No occurrences found to link.');
    return;
  }
  if (!confirm(`This will link ${total} occurrence${total === 1 ? '' : 's'}. Continue?`)) return;
  // Apply updates and persist
  for (const b of blocks) {
    const p = previews.get(String(b.id));
    if (!p) continue;
    try {
      const content = JSON.parse(b.contentJson || '{}');
      const props = JSON.parse(b.propsJson || '{}');
      const patchBlock = {
        contentJson: JSON.stringify({ ...(content || {}), text: p.nextText }),
        propsJson: JSON.stringify({ ...(props || {}), html: p.nextHtml }),
      };
      updateCurrentBlocks(x => String(x.id) === String(b.id)
        ? { ...x, contentJson: patchBlock.contentJson, propsJson: patchBlock.propsJson }
        : x);
      try {
        if (typeof patchBlockNow === 'function') {
          await patchBlockNow(b.id, { content: { text: p.nextText }, props: { html: p.nextHtml } });
        } else {
          debouncePatch(b.id, { content: { text: p.nextText }, props: { html: p.nextHtml } }, 0);
        }
      } catch {}
    } catch {}
  }
  try { rerenderReadOnlyNow(); } catch {}
  try { modal.style.display = 'none'; } catch {}
}

// Dev-only helpers for quick regression smoke checks from console
try {
  if (window && !window.__o5e_test) {
    window.__o5e_test = {
      countOccurrencesInHtml(html, term) {
        const div = document.createElement('div');
        div.innerHTML = String(html || '');
        return countOccurrencesInElement(div, String(term || ''));
      },
      replaceAllInHtml(html, term, token) {
        const div = document.createElement('div');
        div.innerHTML = String(html || '');
        replaceAllInElementTextNodes(div, String(term || ''), String(token || ''));
        return sanitizeRichHtml(div.innerHTML);
      }
    };
  }
} catch {}
