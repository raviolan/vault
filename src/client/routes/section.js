import { $, escapeHtml } from '../lib/dom.js';
import { loadPages, sectionForType, refreshNav } from '../features/nav.js';
import { getNavGroupsForSection, addGroup, renameGroup, deleteGroup, setGroupForPage } from '../features/navGroups.js';
import { renderWidgetsArea } from '../features/widgets.js';

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
  const pages = await loadPages();
  const label = KEY_TO_LABEL.get(String(key).toLowerCase()) || 'Section';

  const filtered = pages.filter(p => sectionForType(p.type) === label)
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
        const opts = [
          `<option value="">Ungrouped</option>`,
          ...groups.map(g => `<option value="${escapeHtml(g.id)}" ${pageToGroup[p.id]===g.id?'selected':''}>${escapeHtml(g.name)}</option>`),
        ].join('');
        return `<li style="display:flex; align-items:center; gap:8px;">
          <a href="${href}" data-link style="flex:1 1 auto; min-width:0;">${escapeHtml(p.title)}</a>
          <select data-pid="${escapeHtml(p.id)}" title="Group">${opts}</select>
        </li>`;
      }).join('')
    : `<li class="meta">No items yet.</li>`;

  const widgetsHostId = 'sectionWidgetsHost';
  outlet.innerHTML = organizer + `
    <div id="${widgetsHostId}"></div>
    <section class="card">
      <h2>${escapeHtml(label)}</h2>
      <ul>${listHtml}</ul>
    </section>
  `;

  // Render widgets area for this section surface
  try {
    const host = $('#' + widgetsHostId, outlet);
    const surfaceId = `section:${String(key)}`;
    renderWidgetsArea(host, { surfaceId, title: 'Widgets' });
  } catch {}

  // Bind organizer controls
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

    $('#ngAddBtn')?.addEventListener('click', async () => {
      const inp = $('#ngNewName');
      const v = inp?.value || '';
      const id = await addGroup(key, v);
      if (inp) inp.value = '';
      renderGroups();
      try { await refreshNav(); } catch {}
    });
    $('#ngNewName')?.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const inp = e.currentTarget;
        const v = inp?.value || '';
        await addGroup(key, v);
        inp.value = '';
        renderGroups();
        try { await refreshNav(); } catch {}
      }
    });
    ngGroups.addEventListener('click', async (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      const row = el.closest('[data-gid]');
      if (!row) return;
      const gid = row.getAttribute('data-gid');
      if (el.classList.contains('ngRename')) {
        const nameEl = row.querySelector('.ngName');
        const v = nameEl?.value || '';
        await renameGroup(key, gid, v);
        renderGroups();
        try { await refreshNav(); } catch {}
      } else if (el.classList.contains('ngDelete')) {
        await deleteGroup(key, gid);
        renderGroups();
        try { await refreshNav(); } catch {}
      }
    });
  }

  // Bind per-page selectors
  for (const sel of outlet.querySelectorAll('select[data-pid]')) {
    sel.addEventListener('change', async (e) => {
      const s = e.currentTarget;
      const pid = s.getAttribute('data-pid');
      const gid = s.value || null;
      await setGroupForPage(key, pid, gid);
      try { await refreshNav(); } catch {}
    });
  }
}
