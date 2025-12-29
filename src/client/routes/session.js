import { renderWidgetsArea } from '../features/widgets.js';
import { renderHeaderMedia } from '../features/headerMedia.js';
import { setUiMode } from '../lib/uiMode.js';
import { uploadMedia, updatePosition, deleteMedia } from '../lib/mediaUpload.js';
import { loadState, getState, updateState, saveStateNow } from '../lib/state.js';
import { fetchJson } from '../lib/http.js';
import { renderBlocksReadOnly } from '../blocks/readOnly.js';
import { setPageActionsEnabled } from '../lib/ui.js';
import { isEditingPage, setEditModeForPage, getCurrentPageBlocks, setCurrentPageBlocks } from '../lib/pageStore.js';

export function render(container, ctx = {}) {
  if (!container) return;
  // Enable global Edit in top bar for Session
  try { setPageActionsEnabled({ canEdit: true, canDelete: false }); } catch {}
  // Page-like layout mirroring Dashboard
  container.innerHTML = `
    <article class="page">
      <div id="surfaceHeader"></div>
      <div class="page-title-row" style="display:flex;align-items:center;gap:8px;margin:4px 0;">
        <h1 style="flex:1 1 auto;">Session</h1>
      </div>
      <div id="sessionBlocks" class="page-body"></div>
      <div id="sessionWidgetsHost"></div>
    </article>
  `;

  const surfaceId = 'session';
  const pageId = 'session';
  let media = null;
  let page = null; // Virtual page data loaded from /api/pages/session
  const headerHost = container.querySelector('#surfaceHeader');
  const blocksRoot = container.querySelector('#sessionBlocks');
  const widgetsHost = container.querySelector('#sessionWidgetsHost');
  let headerCtl = null;
  const btnEdit = document.getElementById('btnEditPage');

  async function ensurePageLoaded() {
    if (page) return page;
    try {
      page = await fetchJson('/api/pages/session');
    } catch (e) {
      page = { id: 'session', title: 'Session', blocks: [] };
    }
    setCurrentPageBlocks(page.blocks || []);
    return page;
  }

  async function refresh() {
    await ensurePageLoaded();
    const editing = isEditingPage('session');

    // Header media state and rendering (same pattern as Dashboard)
    const state = getState();
    const surf = state?.surfaceMediaV1?.surfaces?.[surfaceId] || null;
    media = surf && surf.header ? { url: `/media/${surf.header.path}`, posX: surf.header.posX, posY: surf.header.posY } : null;
    const styleCfg = state?.surfaceStyleV1?.surfaces?.[surfaceId]?.header || {};
    const sizeMode = (styleCfg?.fit === true) ? 'contain' : 'cover';
    const heightPx = Number.isFinite(styleCfg?.heightPx) ? styleCfg.heightPx : null;
    renderHeaderMedia(headerHost, {
      mode: editing ? 'edit' : 'view',
      cover: media,
      profile: null,
      showProfile: false,
      variant: 'tall',
      sizeMode,
      heightPx,
      async onUploadCover(file) {
        const resp = await uploadMedia({ scope: 'surface', surfaceId, slot: 'header', file });
        media = { url: resp.url, posX: resp.posX, posY: resp.posY };
        refresh();
      },
      async onRemoveCover() {
        await deleteMedia({ scope: 'surface', surfaceId, slot: 'header' });
        media = null; refresh();
      },
      async onSavePosition(slot, x, y) {
        await updatePosition({ scope: 'surface', surfaceId, slot: 'header', posX: x, posY: y });
        if (media) { media.posX = x; media.posY = y; }
        refresh();
      }
    });

    // Header controls only in edit (fit toggle + height)
    if (editing) {
      if (!headerCtl) {
        headerCtl = document.createElement('div');
        headerCtl.id = 'sessionHeaderControls';
        headerCtl.style.display = 'flex';
        headerCtl.style.alignItems = 'center';
        headerCtl.style.gap = '10px';
        headerCtl.style.margin = '8px 0 12px 0';
        headerHost.after(headerCtl);
      }
      const cur = styleCfg || {};
      const checked = cur?.fit === true ? 'checked' : '';
      const hVal = Number.isFinite(cur?.heightPx) ? cur.heightPx : '';
      headerCtl.innerHTML = `
        <span class="meta">Header</span>
        <label style="display:flex;gap:6px;align-items:center">
          <input id="sessFitToggle" type="checkbox" ${checked} />
          <span>Show full image</span>
        </label>
        <label class="meta">Height</label>
        <input id="sessHeaderHeight" type="number" min="140" max="800" step="10" value="${hVal}" placeholder="auto" style="width:90px" />
        <span class="meta" style="opacity:0.7">px</span>
      `;
      const fitEl = headerCtl.querySelector('#sessFitToggle');
      const hEl = headerCtl.querySelector('#sessHeaderHeight');
      fitEl?.addEventListener('change', () => {
        const st = getState();
        const block = { ...(st.surfaceStyleV1 || { surfaces: {} }) };
        const surfaces = { ...(block.surfaces || {}) };
        const prev = surfaces[surfaceId] || {};
        const header = { ...(prev.header || {}), fit: !!fitEl.checked };
        surfaces[surfaceId] = { ...prev, header };
        updateState({ surfaceStyleV1: { surfaces } });
        refresh();
      });
      hEl?.addEventListener('change', () => {
        const v = Number(hEl.value);
        const heightPx = Number.isFinite(v) && v > 0 ? Math.max(140, Math.min(800, Math.floor(v))) : null;
        const st = getState();
        const block = { ...(st.surfaceStyleV1 || { surfaces: {} }) };
        const surfaces = { ...(block.surfaces || {}) };
        const prev = surfaces[surfaceId] || {};
        const header = { ...(prev.header || {}), ...(heightPx ? { heightPx } : { heightPx: null }) };
        surfaces[surfaceId] = { ...prev, header };
        updateState({ surfaceStyleV1: { surfaces } });
        refresh();
      });
    } else if (headerCtl) {
      try { headerCtl.remove(); } catch {}
      headerCtl = null;
    }

    // Blocks area
    if (blocksRoot) {
      if (editing) {
        try {
          const mod = await import('../blocks/edit/render.js');
          const { renderBlocksEdit } = mod;
          renderBlocksEdit(blocksRoot, page, getCurrentPageBlocks());
        } catch (e) {
          console.error('Failed to render session blocks editor', e);
          try { renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks()); } catch {}
        }
      } else {
        try { renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks()); } catch {}
      }
    }
  }

  // Bind global Edit button behavior
  if (btnEdit) {
    const setLabel = () => { btnEdit.textContent = isEditingPage('session') ? 'Done' : 'Edit'; };
    setLabel();
    btnEdit.onclick = async () => {
      const now = !isEditingPage('session');
      setEditModeForPage('session', now);
      setLabel();
      if (now) {
        setUiMode('edit');
        await refresh();
      } else {
        setUiMode(null);
        try {
          const { flushDebouncedPatches } = await import('../blocks/edit/state.js');
          await flushDebouncedPatches();
        } catch (e) { console.error('Failed to flush debounced patches', e); }
        try {
          const { refreshBlocksFromServer } = await import('../blocks/edit/apiBridge.js');
          await refreshBlocksFromServer('session');
        } catch (e) { console.error('Failed to refresh blocks from server', e); }
        try { await saveStateNow(); } catch {}
        await refresh();
      }
    };
  }

  // Initial render + widgets
  void refresh();
  try { renderWidgetsArea(widgetsHost, { surfaceId, title: 'Widgets' }); } catch {}

  // Cleanup on route change
  return () => {
    try {
      if (btnEdit) btnEdit.onclick = null;
    } catch {}
    try {
      if (isEditingPage('session')) {
        setEditModeForPage('session', false);
        setUiMode(null);
      }
    } catch {}
  };
}
