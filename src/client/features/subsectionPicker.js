import { getNavGroupsForSection, setGroupForPage, addGroup } from './navGroups.js';
import { refreshNav } from './nav.js';

// Small, focused UI helper to mount a subsection/category picker.
// Contract:
// mountSubsectionPicker({ hostEl, sectionKey, itemId, onAfterChange, labelText })
export function mountSubsectionPicker(opts) {
  const host = opts?.hostEl || null;
  const sectionKey = String(opts?.sectionKey || '').toLowerCase();
  const itemId = String(opts?.itemId || '');
  const onAfterChange = typeof opts?.onAfterChange === 'function' ? opts.onAfterChange : null;
  const labelText = String(opts?.labelText || 'Category');
  if (!host || !sectionKey || !itemId) return;

  // Styling: compact inline row to match existing meta/chips
  try {
    host.innerHTML = '';
    host.style.display = 'flex';
    host.style.alignItems = 'center';
    host.style.gap = '8px';
    host.style.flexWrap = 'wrap';
  } catch {}

  const wrap = document.createElement('div');
  wrap.className = 'subsection-picker';

  const label = document.createElement('label');
  label.className = 'meta';
  label.textContent = `${labelText} `;
  const sel = document.createElement('select');
  sel.style.minWidth = '160px';
  label.appendChild(sel);
  wrap.appendChild(label);

  // Optional New… button (mirrors edit-mode UX)
  const btnNew = document.createElement('button');
  btnNew.type = 'button';
  btnNew.className = 'chip';
  btnNew.textContent = 'New…';
  wrap.appendChild(btnNew);

  host.appendChild(wrap);

  function buildOptions() {
    const { groups, pageToGroup } = getNavGroupsForSection(sectionKey);
    const current = pageToGroup?.[itemId] || '';
    sel.innerHTML = '';
    const o0 = document.createElement('option');
    o0.value = '';
    o0.textContent = 'Ungrouped';
    sel.appendChild(o0);
    for (const g of (groups || [])) {
      const o = document.createElement('option');
      o.value = String(g.id);
      o.textContent = g.name || '';
      if (String(current) === String(g.id)) o.selected = true;
      sel.appendChild(o);
    }
  }

  buildOptions();

  sel.addEventListener('change', async () => {
    const gid = sel.value || null;
    try {
      await setGroupForPage(sectionKey, itemId, gid);
      try { await refreshNav(); } catch {}
      if (onAfterChange) { try { onAfterChange(); } catch {} }
    } catch (e) {
      console.error('[subsectionPicker] Failed to set group', e);
    }
  });

  btnNew.addEventListener('click', async () => {
    const name = prompt('New category name');
    if (!name) return;
    try {
      const newId = await addGroup(sectionKey, name);
      if (!newId) return;
      buildOptions();
      sel.value = String(newId);
      await setGroupForPage(sectionKey, itemId, newId);
      try { await refreshNav(); } catch {}
      if (onAfterChange) { try { onAfterChange(); } catch {} }
    } catch (e) {
      console.error('[subsectionPicker] Failed to create group', e);
    }
  });
}

