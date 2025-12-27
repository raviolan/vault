import { renderWidgetsArea } from '../features/widgets.js';
import { renderHeaderMedia } from '../features/headerMedia.js';
import { uploadMedia, updatePosition, deleteMedia } from '../lib/mediaUpload.js';
import { loadState } from '../lib/state.js';

export function render(container, ctx = {}) {
  if (!container) return;
  container.innerHTML = `
    <section>
      <div id="surfaceHeader"></div>
      <div style=\"display:flex; align-items:center; gap:8px; margin: 4px 0;\">
        <h1 style=\"flex:1 1 auto;\">Session</h1>
        <button id=\"btnCustomize\" type=\"button\" class=\"chip\">Customize</button>
      </div>
    </section>
    <div id=\"sessionWidgetsHost\"></div>
  `;
  const surfaceId = 'session';
  let customizing = false;
  let media = null;
  const headerHost = container.querySelector('#surfaceHeader');
  const btn = container.querySelector('#btnCustomize');
  async function refresh() {
    const state = await loadState();
    const surf = state?.surfaceMediaV1?.surfaces?.[surfaceId] || null;
    media = surf && surf.header ? { url: `/media/${surf.header.path}`, posX: surf.header.posX, posY: surf.header.posY } : null;
    renderHeaderMedia(headerHost, {
      mode: customizing ? 'edit' : 'view',
      cover: media,
      profile: null,
      showProfile: false,
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
  }
  if (btn) btn.onclick = () => { customizing = !customizing; btn.textContent = customizing ? 'Done' : 'Customize'; refresh(); };
  void refresh();
  const widgetsHost = container.querySelector('#sessionWidgetsHost');
  try { renderWidgetsArea(widgetsHost, { surfaceId, title: 'Widgets' }); } catch {}
}
