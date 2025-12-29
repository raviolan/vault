import { renderWidgetsArea } from '../features/widgets.js';
import { renderHeaderMedia } from '../features/headerMedia.js';
import { uploadMedia, updatePosition, deleteMedia } from '../lib/mediaUpload.js';
import { loadState, getState, updateState, saveStateNow } from '../lib/state.js';
import { fetchJson } from '../lib/http.js';
import { renderBlocksReadOnly } from '../blocks/readOnly.js';
import { setPageActionsEnabled } from '../lib/ui.js';
import { getCurrentPageBlocks, setCurrentPageBlocks } from '../lib/pageStore.js';

export function render(container, ctx = {}) {
  if (!container) return;
  // Enable global Edit in top bar for Dashboard
  try { setPageActionsEnabled({ canEdit: true, canDelete: false }); } catch {}
  // Page-like layout to reuse existing CSS and editor behaviors
  container.innerHTML = `
    <article class="page page--dashboard">
      <div id="surfaceHeader"></div>
      <div class="page-identity">
        <div class="avatar-col"></div>
        <div class="name-col">
          <h1>Dashboard</h1>
        </div>
      </div>
      <div class="page-body" id="dashBlocks"></div>
    </article>
    <div id="dashWidgetsHost"></div>
  `;
  const surfaceId = 'dashboard';
  let media = null;
  let page = null; // Virtual page data loaded from /api/pages/dashboard
  const headerHost = container.querySelector('#surfaceHeader');
  const blocksRoot = container.querySelector('#dashBlocks');
  const widgetsHost = container.querySelector('#dashWidgetsHost');
  let headerCtl = null;
  let mo = null; // MutationObserver for global edit mode

  async function ensurePageLoaded() {
    if (page) return page;
    try {
      page = await fetchJson('/api/pages/dashboard');
    } catch (e) {
      // Fallback minimal object if not present to keep editor stable
      page = { id: 'dashboard', title: 'Dashboard', blocks: [] };
    }
    // Initialize current blocks for the virtual page
    setCurrentPageBlocks(page.blocks || []);
    return page;
  }
  async function refresh() {
    // Load dashboard page and derive mode from global top-bar
    await ensurePageLoaded();
    const editing = document.body?.dataset?.mode === 'edit';

    // Read current in-memory state to avoid races with debounced saves
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

    // Render header style controls only when globally editing
    if (editing) {
      if (!headerCtl) {
        headerCtl = document.createElement('div');
        headerCtl.id = 'dashHeaderControls';
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
          <input id="dashFitToggle" type="checkbox" ${checked} />
          <span>Show full image</span>
        </label>
        <label class="meta">Height</label>
        <input id="dashHeaderHeight" type="number" min="140" max="800" step="10" value="${hVal}" placeholder="auto" style="width:90px" />
        <span class="meta" style="opacity:0.7">px</span>
      `;
      const fitEl = headerCtl.querySelector('#dashFitToggle');
      const hEl = headerCtl.querySelector('#dashHeaderHeight');
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

    // Render blocks area: edit when global edit is on
    if (blocksRoot) {
      if (editing) {
        try {
          const mod = await import('../blocks/edit/render.js');
          const { renderBlocksEdit } = mod;
          renderBlocksEdit(blocksRoot, page, getCurrentPageBlocks());
        } catch (e) {
          console.error('Failed to render dashboard blocks editor', e);
          try { renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks()); } catch {}
        }
      } else {
        try { renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks()); } catch {}
      }
    }
  }
  // React to global top-bar Edit toggle (data-mode changes)
  mo = new MutationObserver(() => {
    // If container was removed, disconnect observer
    if (!container.isConnected) { try { mo.disconnect(); } catch {} return; }
    void refresh();
  });
  try { mo.observe(document.body, { attributes: true, attributeFilter: ['data-mode'] }); } catch {}
  void refresh();
  try { renderWidgetsArea(widgetsHost, { surfaceId, title: 'Widgets' }); } catch {}

  // Cleanup on route change
  return () => {
    try { mo && mo.disconnect(); } catch {}
  };
}
