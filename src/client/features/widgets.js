import { fetchJson } from '../lib/http.js';
import { escapeHtml } from '../lib/dom.js';
import { getState, updateState } from '../lib/state.js';
import { getCachedPages, loadPages } from './nav.js';

// State helpers (additive, backward compatible)
function getWidgetsState() {
  const st = getState() || {};
  return st.widgetsV1 || { surfaces: {} };
}

export function getWidgets(surfaceId) {
  const w = getWidgetsState();
  return (w.surfaces && w.surfaces[surfaceId] && Array.isArray(w.surfaces[surfaceId].items)) ? w.surfaces[surfaceId].items : [];
}

// Per-surface layout: 'grid' (default) or 'carousel'
export function getSurfaceLayout(surfaceId) {
  const w = getWidgetsState();
  const lay = w?.surfaces?.[surfaceId]?.layout;
  return (lay === 'carousel' ? 'carousel' : 'grid');
}

export function setSurfaceLayout(surfaceId, layout) {
  const st = getState() || {};
  const cur = st.widgetsV1 || { surfaces: {} };
  const prevSurf = (cur.surfaces || {})[surfaceId] || {};
  const next = {
    widgetsV1: {
      surfaces: {
        ...(cur.surfaces || {}),
        [surfaceId]: { ...prevSurf, layout: (layout === 'carousel' ? 'carousel' : 'grid') },
      }
    }
  };
  updateState(next);
  return getSurfaceLayout(surfaceId);
}

export function setWidgets(surfaceId, nextItems) {
  const st = getState() || {};
  const cur = st.widgetsV1 || { surfaces: {} };
  const prevSurf = (cur.surfaces || {})[surfaceId] || {};
  const next = {
    widgetsV1: {
      surfaces: {
        ...(cur.surfaces || {}),
        [surfaceId]: { ...prevSurf, items: Array.isArray(nextItems) ? nextItems : [] },
      }
    }
  };
  updateState(next);
  return getWidgets(surfaceId);
}

export function addWidget(surfaceId, widget) {
  const items = getWidgets(surfaceId).slice();
  items.push(widget);
  return setWidgets(surfaceId, items);
}

export function removeWidget(surfaceId, widgetId) {
  const items = getWidgets(surfaceId).filter(w => String(w?.id) !== String(widgetId));
  return setWidgets(surfaceId, items);
}

export function moveWidget(surfaceId, widgetId, dir) {
  const items = getWidgets(surfaceId).slice();
  const i = items.findIndex(w => String(w?.id) === String(widgetId));
  if (i < 0) return items;
  const j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= items.length) return items;
  const tmp = items[i];
  items[i] = items[j];
  items[j] = tmp;
  return setWidgets(surfaceId, items);
}

// Rendering: widgets area and page snapshot cards
export async function renderWidgetsArea(hostEl, { surfaceId } = {}) {
  if (!(hostEl instanceof HTMLElement)) return;
  const items = getWidgets(surfaceId);

  const wrap = document.createElement('section');
  // No card background, no header/title — only the grid and optional editor (edit mode only)
  wrap.className = 'widgetsArea';
  wrap.innerHTML = `
    <div class="widgetsGrid"></div>
    <div class="widgetsEditor" style="display:none; margin-top: 8px;"></div>
  `;
  hostEl.appendChild(wrap);

  const grid = wrap.querySelector('.widgetsGrid');
  const editor = wrap.querySelector('.widgetsEditor');
  // Editing is driven by global topbar Edit mode
  const isEditMode = () => (document?.body?.dataset?.mode === 'edit');

  const applyLayoutClass = () => {
    const layout = getSurfaceLayout(surfaceId);
    // Keep base grid class for default grid styles; add specific layout modifier
    grid.classList.toggle('widgetsLayout--carousel', layout === 'carousel');
    grid.classList.toggle('widgetsLayout--grid', layout !== 'carousel');
  };

  const renderView = (snapshotsMap) => {
    const curItems = getWidgets(surfaceId);
    applyLayoutClass();
    grid.innerHTML = '';
    for (const w of curItems) {
      if (w.type === 'pageSnapshot') {
        const a = document.createElement('a');
        a.className = 'widgetCard';
        a.setAttribute('data-link', '');
        a.href = `/page/${encodeURIComponent(w.pageId)}`;

        const inner = document.createElement('div');
        inner.className = 'widgetCardInner widgetCardLarge';
        a.appendChild(inner);

        // Large cover area on top
        const cover = document.createElement('div');
        cover.className = 'widgetCover';
        inner.appendChild(cover);

        const body = document.createElement('div');
        body.className = 'widgetCardBody';
        inner.appendChild(body);

        const titleRow = document.createElement('div');
        titleRow.className = 'widgetCardTitleRow';
        body.appendChild(titleRow);

        const titleEl = document.createElement('div');
        titleEl.className = 'widgetCardTitle';
        titleEl.textContent = 'Loading…';
        titleRow.appendChild(titleEl);

        if (isEditMode()) {
          a.addEventListener('click', (e) => { e.preventDefault(); });
          const actions = document.createElement('div');
          actions.className = 'widgetCardActions';
          actions.setAttribute('data-edit-only', '1');
          actions.innerHTML = `
            <button type="button" class="widgetAction widgetMoveLeft" data-act="left" title="Move left" aria-label="Move left">←</button>
            <button type="button" class="widgetAction widgetMoveRight" data-act="right" title="Move right" aria-label="Move right">→</button>
            <button type="button" class="widgetAction widgetRemove" data-act="remove" title="Remove" aria-label="Remove">×</button>`;
          actions.addEventListener('click', (e) => {
            const btn = e.target;
            if (!(btn instanceof HTMLElement)) return;
            e.preventDefault();
            e.stopPropagation();
            const act = btn.getAttribute('data-act');
            if (act === 'remove') { removeWidget(surfaceId, w.id); renderAll(); }
            if (act === 'left') { moveWidget(surfaceId, w.id, -1); renderAll(); }
            if (act === 'right') { moveWidget(surfaceId, w.id, +1); renderAll(); }
          });
          titleRow.appendChild(actions);
        }

        const metaEl = document.createElement('div');
        metaEl.className = 'widgetCardMeta';
        body.appendChild(metaEl);

        const ctxEl = document.createElement('div');
        ctxEl.className = 'widgetCardContext';
        ctxEl.textContent = 'Loading…';
        body.appendChild(ctxEl);

        grid.appendChild(a);

        const snap = snapshotsMap?.get(w.pageId);
        if (snap && !snap.missing) {
          const t = a.querySelector('.widgetCardTitle');
          const m = a.querySelector('.widgetCardMeta');
          const c = a.querySelector('.widgetCardContext');
          if (t) t.textContent = snap.title || 'Untitled';
          // Link: prefer slug when present
          if (snap.slug) a.href = `/p/${encodeURIComponent(snap.slug)}`;
          // Meta line: Type • ContextTitle (if different)
          if (m) {
            const bits = [];
            if (snap.type) {
              try { bits.push(String(snap.type).slice(0,1).toUpperCase() + String(snap.type).slice(1)); } catch { bits.push(String(snap.type)); }
            }
            if (snap.contextTitle && snap.contextTitle !== snap.title) bits.push(snap.contextTitle);
            m.textContent = bits.join(' • ');
          }
          if (c) {
            const lines = [];
            if (snap.contextText) lines.push(snap.contextText);
            c.textContent = lines.length ? lines.join(' — ') : '';
          }
          // Cover image or subtle placeholder
          const cov = a.querySelector('.widgetCover');
          if (cov) {
            cov.innerHTML = '';
            if (snap.thumbUrl) {
              const img = document.createElement('img');
              img.className = 'widgetCoverImg';
              img.loading = 'lazy';
              img.alt = '';
              img.src = snap.thumbUrl;
              cov.appendChild(img);
            } else {
              // leave placeholder background via CSS
            }
          }
        } else if (snap && snap.missing) {
          const t = a.querySelector('.widgetCardTitle');
          const c = a.querySelector('.widgetCardContext');
          if (t) t.textContent = 'Missing page';
          if (c) c.textContent = '';
        }
      }
    }
  };

  const renderEditor = async () => {
    if (!isEditMode()) { editor.style.display = 'none'; editor.innerHTML = ''; return; }
    editor.style.display = '';
    // Load pages list (cached first)
    let pages = getCachedPages();
    if (!Array.isArray(pages) || !pages.length) {
      try { pages = await loadPages(); } catch { pages = []; }
    }
    // Build simple select to add a pageSnapshot
    const opts = pages.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)} (${escapeHtml(p.type)})</option>`).join('');
    const currentLayout = getSurfaceLayout(surfaceId);
    editor.innerHTML = `
      <div class="widgetsToolbar" style="display:flex; gap:10px; align-items:center; flex-wrap: wrap;">
        <div class="widgetsLayoutToggle" role="group" aria-label="Widgets layout">
          <button type="button" class="chip layoutChipGrid ${currentLayout !== 'carousel' ? 'is-active' : ''}" data-layout="grid">Grid</button>
          <button type="button" class="chip layoutChipCarousel ${currentLayout === 'carousel' ? 'is-active' : ''}" data-layout="carousel">Carousel</button>
        </div>
        <div class="widgetAddRow" style="margin-top:0;">
          <select class="widgetAddSelect">
            <option value="">Select a page…</option>
            ${opts}
          </select>
          <button type="button" class="widgetAddBtn">Add Page Card</button>
        </div>
      </div>
    `;
    const btn = editor.querySelector('.widgetAddBtn');
    const sel = editor.querySelector('.widgetAddSelect');
    btn?.addEventListener('click', () => {
      const pid = sel?.value || '';
      if (!pid) return;
      const widget = { id: `w_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, type: 'pageSnapshot', pageId: pid };
      addWidget(surfaceId, widget);
      renderAll();
    });

    const layoutGroup = editor.querySelector('.widgetsLayoutToggle');
    layoutGroup?.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const lay = t.getAttribute('data-layout');
      if (!lay) return;
      setSurfaceLayout(surfaceId, lay);
      // Update active chip state without full re-render
      editor.querySelectorAll('.widgetsLayoutToggle .chip').forEach((el) => {
        el.classList.toggle('is-active', el.getAttribute('data-layout') === getSurfaceLayout(surfaceId));
      });
      applyLayoutClass();
    });
  };

  const renderAll = async () => {
    // snapshots fetch in one call
    const curItems = getWidgets(surfaceId);
    const ids = curItems.filter(w => w.type === 'pageSnapshot').map(w => w.pageId);
    const map = new Map();
    if (ids.length) {
      try {
        const q = encodeURIComponent(ids.join(','));
        const resp = await fetchJson(`/api/pages/snapshots?ids=${q}`);
        const arr = resp?.snapshots || [];
        for (let i = 0; i < arr.length; i++) {
          const s = arr[i];
          if (s && s.id) map.set(s.id, s);
        }
      } catch {
        // ignore; leave placeholders
      }
    }
    renderView(map);
    await renderEditor();
  };

  // Initial render
  renderAll();
  // Observe edit mode changes (simple polling fallback to avoid wiring custom events)
  let prevMode = isEditMode();
  const i = setInterval(() => {
    const cur = isEditMode();
    if (cur !== prevMode) { prevMode = cur; renderAll(); }
  }, 400);
  // Best-effort cleanup if host is removed
  const mo = new MutationObserver(() => {
    if (!document.body.contains(hostEl)) { try { clearInterval(i); mo.disconnect(); } catch {} }
  });
  try { mo.observe(document.body, { childList: true, subtree: true }); } catch {}
}
