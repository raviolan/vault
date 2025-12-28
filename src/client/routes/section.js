import { $, escapeHtml } from '../lib/dom.js';
import { setBreadcrumb, setPageActionsEnabled } from '../lib/ui.js';
import { setUiMode } from '../lib/uiMode.js';
import { loadPages, sectionForType, refreshNav } from '../features/nav.js';
import { getState, updateState, saveStateNow } from '../lib/state.js';
import { normalizeSections, removeSection } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
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
  const lowerKey = String(key || '').toLowerCase();
  const labelFromMap = KEY_TO_LABEL.get(lowerKey) || 'Section';
  const st = getState();
  const { sections: userSections } = normalizeSections(st || {});
  const isCustom = lowerKey.startsWith('u-');
  const matchedCustom = isCustom ? (userSections || []).find(s => (`u-${String(s.id)}`) === lowerKey) : null;
  const label = isCustom ? (matchedCustom?.title || 'Section') : labelFromMap;
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

  let filtered = [];
  if (isCustom) {
    // Custom section: resolve by stored pageIds and show those pages
    const ids = Array.isArray(matchedCustom?.pageIds) ? matchedCustom.pageIds : [];
    const pageById = new Map(pages.map(p => [String(p.id), p]));
    filtered = ids.map(id => pageById.get(String(id))).filter(Boolean)
      .slice()
      .sort((a,b) => String(a?.title||'').localeCompare(String(b?.title||'')));
  } else {
    // Core section: filter by type-derived label and exclude pages homed in custom sections
    filtered = pages.filter(p => sectionForType(p.type) === label && !folderIds.has(p.id))
      .slice()
      .sort((a,b) => a.title.localeCompare(b.title));
  }

  const { groups, pageToGroup } = getNavGroupsForSection(key);

  const isEditMode = () => (document?.body?.dataset?.mode === 'edit');
  // Organizer UI (visible only in Edit mode)
  const organizer = isEditMode() ? `
    <section class="card" style="margin-bottom: 12px;">
      <h2>Organize</h2>
      <div style="display:flex; gap:8px; align-items:center; margin: 8px 0;">
        <input id="ngNewName" placeholder="Add group" style="flex:1;" />
        <button id="ngAddBtn" type="button">Add</button>
      </div>
      <div id="ngGroups"></div>
    </section>
  ` : '';

  // Build accordion groups (Nav groups + Ungrouped)
  const byGroupId = new Map();
  for (const g of (groups || [])) byGroupId.set(String(g.id), { id: String(g.id), name: String(g.name || ''), pages: [] });
  const ungrouped = { id: 'ungrouped', name: 'Ungrouped', pages: [] };
  for (const p of filtered) {
    const gid = pageToGroup[p.id] ? String(pageToGroup[p.id]) : '';
    const bucket = gid && byGroupId.has(gid) ? byGroupId.get(gid) : ungrouped;
    bucket.pages.push(p);
  }
  const groupList = [...byGroupId.values(), ungrouped];
  // Persisted accordion open state
  const st2 = getState();
  const accAll = st2?.sectionLandingAccordionV1 || {};
  const acc = accAll[String(key)] || {};
  // Default: open first group with pages if no stored state
  const hasStored = Object.keys(acc).length > 0;
  const defaultOpenId = groupList.find(g => g.pages.length)?.id || (groupList[0]?.id || '');
  const isOpen = (gid) => hasStored ? (acc[gid] !== false) : (gid === defaultOpenId);
  const rowsFor = (p) => {
    const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
    const currentGroupId = pageToGroup[p.id] != null ? String(pageToGroup[p.id]) : '';
    const valid = !!(currentGroupId && (groups || []).some(g => String(g.id) === String(currentGroupId)));
    const opts = [
      `<option value="" ${!valid ? 'selected' : ''}>Ungrouped</option>`,
      ...groups.map(g => `<option value="${String(g.id)}" ${valid && String(g.id)===String(currentGroupId)?'selected':''}>${escapeHtml(g.name)}</option>`),
    ].join('');
    return `<li class="sectionRow" data-pid="${escapeHtml(p.id)}" style="display:flex; align-items:center; gap:8px;">
      <a href="${href}" data-link style="flex:1 1 auto; min-width:0;">${escapeHtml(p.title)}</a>
      ${isEditMode() ? `<select data-pid="${escapeHtml(p.id)}" title="Group">${opts}</select>` : ''}
    </li>`;
  };
  const listHtml = groupList.length ? groupList.map(g => `
    <details class="section-acc" data-acc-id="${escapeHtml(String(g.id))}" ${isOpen(String(g.id)) ? 'open' : ''}>
      <summary class="meta" style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">
        <span style="flex:1 1 auto;min-width:0;">${escapeHtml(g.name)}</span>
        <span class="meta" style="opacity:.8;">${String(g.pages.length)}</span>
      </summary>
      <ul style="margin-top:8px;">${g.pages.length ? g.pages.map(rowsFor).join('') : '<li class="meta">No items</li>'}</ul>
    </details>
  `).join('') : `<li class="meta">No items yet.</li>`;

  const widgetsHostId = 'sectionWidgetsHost';
  outlet.innerHTML = `
    <div id="surfaceHeader"></div>
    ${organizer}
    <div id="${widgetsHostId}"></div>
    <section class="card">
      <div style="display:flex; align-items:center; gap:8px; margin: 4px 0;">
        <h2 style="flex:1 1 auto;">${escapeHtml(label)}</h2>
        ${isCustom ? '<button id="btnDeleteCustomSection" type="button" class="chip" title="Delete section">Delete section</button>' : ''}
      </div>
      ${listHtml}
    </section>
  `;

  // Rerender helper after organizer changes
  const rerender = async () => { await render(outlet, { key }); };

  // Render widgets area for this section surface
  try {
    const host = $('#' + widgetsHostId, outlet);
    const surfaceId = `section:${String(key)}`;
    renderWidgetsArea(host, { surfaceId });
  } catch {}

  // Render header media for this section surface
  try {
    const surfId = `section:${String(key)}`;
    const hmHost = $('#surfaceHeader', outlet);
    const topEditBtn = document.getElementById('btnEditPage');
    // Edit mode mirrors the global UI mode (topbar Edit)
    let media = null;
    let colorCtl = null;
    const SWATCHES = ['#8b5cf6','#22d3ee','#f472b6','#a3e635','#f59e0b','#ef4444','#3b82f6','#10b981','#eab308','#94a3b8'];
    const normalizeHex = (v) => {
      if (!v) return null;
      let s = String(v).trim();
      if (s.startsWith('#')) s = s.slice(1);
      if (/^[0-9a-f]{3}$/i.test(s)) {
        s = s.split('').map(c => c + c).join('');
      }
      if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toLowerCase()}`;
      return null;
    };
    const refresh = async () => {
      const customizing = document?.body?.dataset?.mode === 'edit';
      const state = await loadState();
      const surf = state?.surfaceMediaV1?.surfaces?.[surfId] || null;
      media = surf && surf.header ? { url: `/media/${surf.header.path}`, posX: surf.header.posX, posY: surf.header.posY, zoom: Number(surf.header.zoom ?? 1) } : null;
      // Section color state
      const curColor = state?.surfaceStyleV1?.surfaces?.[surfId]?.color || null;
      // Apply color immediately to the header host (CSS can read --section-accent)
      try { if (curColor) hmHost.style.setProperty('--section-accent', curColor); else hmHost.style.removeProperty('--section-accent'); } catch {}
      renderHeaderMedia(hmHost, {
        mode: customizing ? 'edit' : 'view',
        cover: media,
        profile: null,
        showProfile: false,
        variant: 'tall',
        async onUploadCover(file) {
          const resp = await uploadMedia({ scope: 'surface', surfaceId: surfId, slot: 'header', file });
          media = { url: resp.url, posX: resp.posX, posY: resp.posY, zoom: Number(resp.zoom ?? 1) };
          refresh();
        },
        async onRemoveCover() {
          await deleteMedia({ scope: 'surface', surfaceId: surfId, slot: 'header' });
          media = null; refresh();
        },
        async onSavePosition(slot, x, y, zoom) {
          await updatePosition({ scope: 'surface', surfaceId: surfId, slot: 'header', posX: x, posY: y, ...(zoom !== undefined ? { zoom } : {}) });
          if (media) { media.posX = x; media.posY = y; if (zoom !== undefined) media.zoom = zoom; }
          refresh();
        }
      });

      // Render/refresh Section color controls below header when customizing
      if (customizing) {
        if (!colorCtl) {
          colorCtl = document.createElement('div');
          colorCtl.id = 'sectionColorControls';
          colorCtl.style.display = 'flex';
          colorCtl.style.alignItems = 'center';
          colorCtl.style.gap = '8px';
          colorCtl.style.margin = '8px 0 12px 0';
          hmHost.after(colorCtl);
        }
        const state2 = getState();
        const cur = state2?.surfaceStyleV1?.surfaces?.[surfId]?.color || '';
        const sw = SWATCHES.map(c => `<button type="button" class="theme-swatch" data-color="${c}" title="${c}" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border);background:${c}"></button>`).join('');
        colorCtl.innerHTML = `
          <span class="meta">Section color</span>
          <input id="sectionColorHex" placeholder="#rrggbb" value="${escapeHtml(cur)}" style="width:110px;" />
          <div style="display:flex;gap:6px;align-items:center;">${sw}</div>
        `;
        const inp = colorCtl.querySelector('#sectionColorHex');
        const applyColor = (hex) => {
          const st = getState();
          const block = { ...(st.surfaceStyleV1 || { surfaces: {} }) };
          const surfaces = { ...(block.surfaces || {}) };
          const prev = surfaces[surfId] || {};
          surfaces[surfId] = { ...prev, color: hex };
          updateState({ surfaceStyleV1: { surfaces } });
          // Apply live
          if (hex) hmHost.style.setProperty('--section-accent', hex); else hmHost.style.removeProperty('--section-accent');
        };
        inp?.addEventListener('change', () => {
          const v = normalizeHex(inp.value);
          if (v) { inp.value = v; applyColor(v); }
        });
        colorCtl.querySelectorAll('button.theme-swatch').forEach(btn => {
          btn.addEventListener('click', () => {
            const hex = btn.getAttribute('data-color');
            if (hex) { applyColor(hex); const inputEl = colorCtl.querySelector('#sectionColorHex'); if (inputEl) inputEl.value = hex; }
          });
        });
      } else if (colorCtl) {
        // Remove control when not customizing
        try { colorCtl.remove(); } catch {}
        colorCtl = null;
      }
    };
    // Wire top toolbar Edit button to toggle section header edit mode
    const onTopEditClick = () => {
      const currentlyEdit = document?.body?.dataset?.mode === 'edit';
      const nextMode = currentlyEdit ? null : 'edit';
      if (topEditBtn) topEditBtn.textContent = nextMode ? 'Done' : 'Edit';
      try { setUiMode(nextMode); } catch {}
      // Re-render whole route to reveal/hide organizer and widget controls
      void rerender();
    };
    // Initialize button state and listener (dedup across re-renders)
    if (topEditBtn) {
      const customizing = document?.body?.dataset?.mode === 'edit';
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

    // Persist accordion open/closed state for groups
    outlet.addEventListener('toggle', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      const det = el.closest('details.section-acc');
      if (!det || det !== el) return;
      const gid = det.getAttribute('data-acc-id') || '';
      const sectionKey = outlet.dataset.sectionKey || '';
      const st = getState() || {};
      const all = { ...(st.sectionLandingAccordionV1 || {}) };
      const cur = { ...(all[sectionKey] || {}) };
      cur[gid] = det.open ? true : false;
      all[sectionKey] = cur;
      updateState({ sectionLandingAccordionV1: all });
    });

    // Organizer buttons: Add/Rename/Delete via delegation
    outlet.addEventListener('click', async (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      const sectionKey = outlet.dataset.sectionKey || '';

      if (el.id === 'btnDeleteCustomSection') {
        e.preventDefault();
        e.stopPropagation();
        // Only applicable for custom sections
        if (!sectionKey.startsWith('u-')) return;
        const name = label || 'this section';
        const ok = window.confirm(`Delete section "${name}"?\n\nPages inside will return to their core section lists.`);
        if (!ok) return;
        try {
          let st = getState();
          const id = sectionKey.replace(/^u-/, '');
          st = removeSection(st, id);
          updateState(st);
          await saveStateNow();
          await refreshNav();
          navigate('/');
          return;
        } catch (err) {
          console.error('Failed to delete section', err);
          return;
        }
      }

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
