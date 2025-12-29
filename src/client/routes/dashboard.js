import { renderWidgetsArea } from '../features/widgets.js';
import { renderHeaderMedia } from '../features/headerMedia.js';
import { setUiMode } from '../lib/uiMode.js';
import { uploadMedia, updatePosition, deleteMedia } from '../lib/mediaUpload.js';
import { loadState } from '../lib/state.js';
import { fetchJson } from '../lib/http.js';
import { renderBlocksReadOnly } from '../blocks/readOnly.js';
import { getCurrentPageBlocks, setCurrentPageBlocks } from '../lib/pageStore.js';

export function render(container, ctx = {}) {
  if (!container) return;
  // Page-like layout to reuse existing CSS and editor behaviors
  container.innerHTML = `
    <article class="page page--dashboard">
      <div id="surfaceHeader"></div>
      <div class="page-identity">
        <div class="avatar-col"></div>
        <div class="name-col">
          <h1>Dashboard</h1>
        </div>
        <div class="actions-col" role="toolbar" aria-label="Dashboard actions">
          <button id="btnCustomize" type="button" class="chip">Customize</button>
        </div>
      </div>
      <div class="page-body" id="dashBlocks"></div>
    </article>
    <div id="dashWidgetsHost"></div>
  `;
  const surfaceId = 'dashboard';
  let customizing = false;
  let media = null;
  let page = null; // Virtual page data loaded from /api/pages/dashboard
  const headerHost = container.querySelector('#surfaceHeader');
  const btn = container.querySelector('#btnCustomize');
  const blocksRoot = container.querySelector('#dashBlocks');
  const widgetsHost = container.querySelector('#dashWidgetsHost');

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
    // Load dashboard page and keep UI mode in sync with customizing
    await ensurePageLoaded();
    try { setUiMode(customizing ? 'edit' : null); } catch {}

    const state = await loadState();
    const surf = state?.surfaceMediaV1?.surfaces?.[surfaceId] || null;
    media = surf && surf.header ? { url: `/media/${surf.header.path}`, posX: surf.header.posX, posY: surf.header.posY } : null;
    renderHeaderMedia(headerHost, {
      mode: customizing ? 'edit' : 'view',
      cover: media,
      profile: null,
      showProfile: false,
      variant: 'tall',
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

    // Render blocks area: read-only in view mode, editor in customize mode
    if (blocksRoot) {
      if (customizing) {
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
  if (btn) btn.onclick = () => {
    customizing = !customizing;
    btn.textContent = customizing ? 'Done' : 'Customize';
    refresh();
  };
  void refresh();
  try { renderWidgetsArea(widgetsHost, { surfaceId, title: 'Widgets' }); } catch {}
}
