import { $, escapeHtml } from '../lib/dom.js';
import { setBreadcrumb, setPageActionsEnabled } from '../lib/ui.js';
import { setUiMode } from '../lib/uiMode.js';
import { loadPages, sectionForType, refreshNav } from '../features/nav.js';
import { getState } from '../lib/state.js';
import { normalizeSections } from '../lib/sections.js';
import { getNavGroupsForSection, addGroup, renameGroup, deleteGroup, setGroupForPage } from '../features/navGroups.js';
import { renderWidgetsArea } from '../features/widgets.js';
import { renderHeaderMedia } from '../features/headerMedia.js';
import { uploadMedia, updatePosition, deleteMedia } from '../lib/mediaUpload.js';
import { loadState } from '../lib/state.js';

const KEY_TO_LABEL = new Map([
  ['characters', 'Characters'],
  ['npcs', 'NPCs'],
  ['world', 'World'],
  ['arcs', 'Arcs'],
  ['campaign', 'Campaign'],
  ['tools', 'Tools'],
  ['other', 'Other'],
]);

export async function render(outlet, { key }) {
  if (!outlet) return;
  // Store section key on the outlet for delegated handlers
  outlet.dataset.sectionKey = String(key || '');
  // Local cleanup for header media click binding
  let cleanupHeaderMedia = null;
  const pages = await loadPages();
  const label = KEY_TO_LABEL.get(String(key).toLowerCase()) || 'Section';
  try { setBreadcrumb(label); } catch {}
  try { setPageActionsEnabled({ canEdit: true, canDelete: false }); } catch {}

  // Build set of page ids that belong to user folders; exclude them from core section listings
  function getFolderPageIdSet() {
    const st = getState();
    const { sections } = normalizeSections(st || {});
    const set = new Set();
    for (const sec of sections || []) {
      const title = String(sec.title || '').trim().toLowerCase();
      if (!title) continue;
      if (title === 'enemies') continue;
      if (title === 'favorites') continue;
      for (const id of (Array.isArray(sec.pageIds) ? sec.pageIds : [])) set.add(id);
    }
    return set;
  }
  const folderIds = getFolderPageIdSet();

  const filtered = pages.filter(p => sectionForType(p.type) === label && !folderIds.has(p.id))
    .slice()
    .sort((a,b) => a.title.localeCompare(b.title));

  const { groups, pageToGroup } = getNavGroupsForSection(key);

  // Organizer UI
  const organizer = `
    <section class="card" style="margin-bottom: 12px;">
      <h2>Organize</h2>
      <div style="display:flex; gap:8px; align-items:center; margin: 8px 0;">
        <input id="ngNewName" placeholder="Add group" style="flex:1;" />
        <button id="ngAddBtn" type="button">Add</button>
      </div>
      <div id="ngGroups"></div>
    </section>
  `;

  const listHtml = filtered.length
    ? filtered.map(p => {
        const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
        const currentGroupId = pageToGroup[p.id] != null ? String(pageToGroup[p.id]) : '';
        const valid = !!(currentGroupId && (groups || []).some(g => String(g.id) === String(currentGroupId)));
        const opts = [
          `<option value="" ${!valid ? 'selected' : ''}>Ungrouped</option>`,
          ...groups.map(g => `<option value="${String(g.id)}" ${valid && String(g.id)===String(currentGroupId)?'selected':''}>${escapeHtml(g.name)}</option>`),
        ].join('');
        return `<li class="sectionRow" data-pid="${escapeHtml(p.id)}" style="display:flex; align-items:center; gap:8px;">
          <a href="${href}" data-link style="flex:1 1 auto; min-width:0;">${escapeHtml(p.title)}</a>
          <select data-pid="${escapeHtml(p.id)}" title="Group">${opts}</select>
        </li>`;
      }).join('')
    : `<li class="meta">No items yet.</li>`;

  const widgetsHostId = 'sectionWidgetsHost';
  outlet.innerHTML = `
    <div id="surfaceHeader"></div>
    ${organizer}
    <div id="${widgetsHostId}"></div>
    <section class="card">
      <div style="display:flex; align-items:center; gap:8px; margin: 4px 0;">
        <h2 style="flex:1 1 auto;">${escapeHtml(label)}</h2>
      </div>
      <ul>${listHtml}</ul>
    </section>
  `;

  // Rerender helper after organizer changes
  const rerender = async () => { await render(outlet, { key }); };

  // Render widgets area for this section surface
  try {
    const host = $('#' + widgetsHostId, outlet);
    const surfaceId = `section:${String(key)}`;
    renderWidgetsArea(host, { surfaceId, title: 'Widgets' });
  } catch {}

  // Render header media for this section surface
  try {
    const surfId = `section:${String(key)}`;
    const hmHost = $('#surfaceHeader', outlet);
    const topEditBtn = document.getElementById('btnEditPage');
    let customizing = false;
    let media = null;
    const refresh = async () => {
      const state = await loadState();
      const surf = state?.surfaceMediaV1?.surfaces?.[surfId] || null;
      media = surf && surf.header ? { url: `/media/${surf.header.path}`, posX: surf.header.posX, posY: surf.header.posY } : null;
      renderHeaderMedia(hmHost, {
        mode: customizing ? 'edit' : 'view',
        cover: media,
        profile: null,
        showProfile: false,
        variant: 'tall',
        async onUploadCover(file) {
          const resp = await uploadMedia({ scope: 'surface', surfaceId: surfId, slot: 'header', file });
          media = { url: resp.url, posX: resp.posX, posY: resp.posY };
          refresh();
        },
        async onRemoveCover() {
          await deleteMedia({ scope: 'surface', surfaceId: surfId, slot: 'header' });
          media = null; refresh();
        },
        async onSavePosition(slot, x, y) {
          await updatePosition({ scope: 'surface', surfaceId: surfId, slot: 'header', posX: x, posY: y });
          if (media) { media.posX = x; media.posY = y; }
          refresh();
        }
      });
    };
    // Wire top toolbar Edit button to toggle section header edit mode
    const onTopEditClick = () => {
      customizing = !customizing;
      if (topEditBtn) topEditBtn.textContent = customizing ? 'Done' : 'Edit';
      try { setUiMode(customizing ? 'edit' : null); } catch {}
      void refresh();
    };
    // Initialize button state and listener (dedup across re-renders)
    if (topEditBtn) {
      topEditBtn.textContent = customizing ? 'Done' : 'Edit';
      if (topEditBtn.__sectionHeaderMediaClick) {
        topEditBtn.removeEventListener('click', topEditBtn.__sectionHeaderMediaClick);
      }
      topEditBtn.__sectionHeaderMediaClick = onTopEditClick;
      topEditBtn.addEventListener('click', onTopEditClick);
    }
    void refresh();
    // Provide cleanup without exiting render early
    cleanupHeaderMedia = () => {
      try {
        if (topEditBtn) {
          const h = topEditBtn.__sectionHeaderMediaClick;
          if (h) topEditBtn.removeEventListener('click', h);
          delete topEditBtn.__sectionHeaderMediaClick;
        }
      } catch {}
    };
  } catch {}

  // Render organizer controls (events bound via delegation below)
  const ngGroups = $('#ngGroups');
  if (ngGroups) {
    const renderGroups = () => {
      const cur = getNavGroupsForSection(key).groups;
      if (!cur.length) { ngGroups.innerHTML = '<div class="meta">No groups yet.</div>'; return; }
      ngGroups.innerHTML = cur.map(g => `
        <div class="meta" data-gid="${escapeHtml(g.id)}" style="display:flex; align-items:center; gap:8px; margin:4px 0;">
          <input class="ngName" value="${escapeHtml(g.name)}" style="flex:1;" />
          <button class="ngRename" type="button" title="Rename">Rename</button>
          <button class="ngDelete" type="button" title="Delete">Delete</button>
        </div>
      `).join('');
    };
    renderGroups();
  }

  // One-time delegated event bindings to avoid lost listeners on rerender
  if (!outlet.__sectionLandingBound) {
    // Change handler for selects (capture=true to beat link handlers)
    outlet.addEventListener('change', async (e) => {
      const sel = e.target?.closest?.('select[data-pid]');
      if (!sel) return;
      e.preventDefault();
      e.stopPropagation();

      const sectionKey = outlet.dataset.sectionKey || '';
      const pid = sel.getAttribute('data-pid');
      const gid = sel.value || null;
      console.log('[navGroups] setGroupForPage', { sectionKey, pid, gid });

      let badge = sel.parentElement?.querySelector?.('.ngStatus');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'ngStatus meta';
        badge.style.marginLeft = '6px';
        sel.parentElement?.appendChild(badge);
      }
      sel.disabled = true;
      badge.textContent = 'Saving…';

      try {
        await setGroupForPage(sectionKey, pid, gid);
        const { reloadUserState } = await import('../miniapps/state.js');
        await reloadUserState();
        const { getNavGroupsForSection } = await import('../features/navGroups.js');
        const { pageToGroup } = getNavGroupsForSection(sectionKey);
        const persisted = pageToGroup?.[pid] || null;
        const expected = gid ? String(gid) : null;
        if (persisted !== expected) {
          console.error('Nav group did not persist', { sectionKey, pid, expected, persisted });
          badge.textContent = 'Failed';
        } else {
          badge.textContent = 'Saved';
        }
        await refreshNav();
        // Subtle feedback on the changed row (no full rerender)
        try {
          const row = outlet.querySelector(`[data-pid="${pid}"]`)?.closest?.('.sectionRow')
            || outlet.querySelector(`[data-pid="${pid}"]`);
          if (row) {
            row.classList.add('justSaved');
            setTimeout(() => row.classList.remove('justSaved'), 600);
          }
        } catch {}
      } catch (err) {
        console.error('Failed to set nav group', err);
        try { if (badge) badge.textContent = 'Failed'; } catch {}
      } finally {
        sel.disabled = false;
        setTimeout(() => {
          try {
            const b = sel.parentElement?.querySelector?.('.ngStatus');
            if (b && (b.textContent === 'Saved')) b.textContent = '';
          } catch {}
        }, 1200);
      }
    }, true);

    // Organizer buttons: Add/Rename/Delete via delegation
    outlet.addEventListener('click', async (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      const sectionKey = outlet.dataset.sectionKey || '';

      if (el.id === 'ngAddBtn') {
        e.preventDefault();
        const inp = outlet.querySelector('#ngNewName');
        const v = inp?.value || '';
        await addGroup(sectionKey, v);
        if (inp) inp.value = '';
        await refreshNav();
        await render(outlet, { key: sectionKey });
        return;
      }

      if (el.closest('.ngRename')) {
        e.preventDefault();
        const row = el.closest('[data-gid]');
        if (!row) return;
        const gid = row.getAttribute('data-gid');
        const nameEl = row.querySelector('.ngName');
        const v = nameEl?.value || '';
        await renameGroup(sectionKey, gid, v);
        await refreshNav();
        await render(outlet, { key: sectionKey });
        return;
      }

      if (el.closest('.ngDelete')) {
        e.preventDefault();
        const row = el.closest('[data-gid]');
        if (!row) return;
        const gid = row.getAttribute('data-gid');
        await deleteGroup(sectionKey, gid);
        await refreshNav();
        await render(outlet, { key: sectionKey });
        return;
      }
    });

    outlet.__sectionLandingBound = true;
  }
  // Return cleanup that includes header media cleanup
  return () => { try { cleanupHeaderMedia?.(); } catch {} };
}
