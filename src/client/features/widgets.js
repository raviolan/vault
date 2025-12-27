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

export function setWidgets(surfaceId, nextItems) {
  const st = getState() || {};
  const cur = st.widgetsV1 || { surfaces: {} };
  const next = {
    widgetsV1: {
      surfaces: {
        ...(cur.surfaces || {}),
        [surfaceId]: { items: Array.isArray(nextItems) ? nextItems : [] },
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
export async function renderWidgetsArea(hostEl, { surfaceId, title } = {}) {
  if (!(hostEl instanceof HTMLElement)) return;
  const items = getWidgets(surfaceId);

  const wrap = document.createElement('section');
  wrap.className = 'widgetsArea card';
  wrap.innerHTML = `
    <div class="widgetsHeader">
      <h2>${escapeHtml(title || 'Widgets')}</h2>
      <div class="widgetsHeaderActions">
        <button type="button" class="widgetsEditToggle">Edit widgets</button>
      </div>
    </div>
    <div class="widgetGrid"></div>
    <div class="widgetsEditor" style="display:none; margin-top: 8px;"></div>
  `;
  hostEl.appendChild(wrap);

  const grid = wrap.querySelector('.widgetGrid');
  const editor = wrap.querySelector('.widgetsEditor');
  const toggleBtn = wrap.querySelector('.widgetsEditToggle');
  let editing = false;

  const renderView = (snapshotsMap) => {
    const curItems = getWidgets(surfaceId);
    grid.innerHTML = '';
    for (const w of curItems) {
      if (w.type === 'pageSnapshot') {
        const a = document.createElement('a');
        a.className = 'widgetCard';
        a.setAttribute('data-link', '');
        a.href = `/page/${encodeURIComponent(w.pageId)}`;

        const body = document.createElement('div');
        body.className = 'widgetCardBody';
        body.innerHTML = `
          <div class="widgetCardTitle">Loading…</div>
          <div class="widgetCardContext meta">Loading…</div>
        `;
        a.appendChild(body);

        if (editing) {
          a.addEventListener('click', (e) => { e.preventDefault(); });
          const controls = document.createElement('div');
          controls.className = 'widgetControls';
          controls.innerHTML = `
            <button type="button" data-act="left" title="Move left">◀</button>
            <button type="button" data-act="right" title="Move right">▶</button>
            <button type="button" data-act="remove" title="Remove">Remove</button>
          `;
          controls.addEventListener('click', (e) => {
            const btn = e.target;
            if (!(btn instanceof HTMLElement)) return;
            const act = btn.getAttribute('data-act');
            if (act === 'remove') { removeWidget(surfaceId, w.id); renderAll(); }
            if (act === 'left') { moveWidget(surfaceId, w.id, -1); renderAll(); }
            if (act === 'right') { moveWidget(surfaceId, w.id, +1); renderAll(); }
          });
          a.appendChild(controls);
        }

        grid.appendChild(a);

        const snap = snapshotsMap?.get(w.pageId);
        if (snap && !snap.missing) {
          const t = a.querySelector('.widgetCardTitle');
          const c = a.querySelector('.widgetCardContext');
          if (t) t.textContent = snap.title || 'Untitled';
          if (c) {
            const lines = [];
            if (snap.contextTitle && snap.contextTitle !== snap.title) lines.push(snap.contextTitle);
            if (snap.contextText) lines.push(snap.contextText);
            c.textContent = lines.length ? lines.join(' — ') : '';
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
    if (!editing) { editor.style.display = 'none'; editor.innerHTML = ''; return; }
    editor.style.display = '';
    // Load pages list (cached first)
    let pages = getCachedPages();
    if (!Array.isArray(pages) || !pages.length) {
      try { pages = await loadPages(); } catch { pages = []; }
    }
    // Build simple select to add a pageSnapshot
    const opts = pages.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)} (${escapeHtml(p.type)})</option>`).join('');
    editor.innerHTML = `
      <div class="widgetAddRow" style="display:flex; gap:8px; align-items:center;">
        <select class="widgetAddSelect" style="flex:1;">
          <option value="">Select a page…</option>
          ${opts}
        </select>
        <button type="button" class="widgetAddBtn">Add Page Card</button>
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

  toggleBtn?.addEventListener('click', () => {
    editing = !editing;
    toggleBtn.textContent = editing ? 'Done' : 'Edit widgets';
    renderAll();
  });

  // Initial render
  renderAll();
}

