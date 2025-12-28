import { $, escapeHtml } from '../lib/dom.js';
import { navigate } from '../lib/router.js';
import { fetchJson } from '../lib/http.js';
import { getState, updateState } from '../lib/state.js';
import { getNavGroupsForSection } from './navGroups.js';
import { normalizeSections } from '../lib/sections.js';
import { TOOLS } from '../tools/index.js';

let cachedPages = [];

export function getCachedPages() { return cachedPages; }

export async function loadPages() {
  cachedPages = await fetchJson('/api/pages');
  return cachedPages;
}

export async function loadNavConfig() {
  try {
    return await fetchJson('/assets/nav.json');
  } catch {
    return { sections: [] };
  }
}

export function sectionForType(type) {
  switch (type) {
    case 'npc': return 'NPCs';
    case 'location': return 'World';
    case 'arc': return 'Arcs';
    case 'tool': return 'Tools';
    case 'pc':
    case 'character':
    default:
      return type === 'note' ? 'Campaign' : 'Characters';
  }
}

// Return a stable section key for a given page type
export function sectionKeyForType(type) {
  switch (type) {
    case 'npc': return 'npcs';
    case 'location': return 'world';
    case 'arc': return 'arcs';
    case 'tool': return 'tools';
    case 'note': return 'campaign';
    case 'pc':
    case 'character':
    default: return 'characters';
  }
}

function sectionKey(label) {
  const key = String(label || '').toLowerCase();
  if (key.includes('npc')) return 'npcs';
  if (key.includes('world') || key.includes('location')) return 'world';
  if (key.includes('arc')) return 'arcs';
  if (key.includes('tool')) return 'tools';
  if (key.includes('campaign')) return 'campaign';
  if (key.includes('char')) return 'characters';
  return 'other';
}

export function renderNavSections(pages, navCfg) {
  const ul = $('#navSections');
  if (!ul) return;
  ul.innerHTML = '';

  // Helper: build a Set of page ids that belong to user folders
  function getFolderPageIdSet() {
    const st = getState();
    const { sections } = normalizeSections(st || {});
    const set = new Set();
    for (const sec of sections || []) {
      const title = String(sec.title || '').trim().toLowerCase();
      // ignore special/hidden sections
      if (!title) continue;
      if (title === 'enemies') continue;
      if (title === 'favorites') continue;
      for (const id of (Array.isArray(sec.pageIds) ? sec.pageIds : [])) set.add(id);
    }
    return set;
  }

  const folderIds = getFolderPageIdSet();
  const corePages = pages.filter(p => !folderIds.has(p.id));

  const bySection = new Map();
  for (const p of corePages) {
    const label = sectionForType(p.type);
    if (!bySection.has(label)) bySection.set(label, []);
    bySection.get(label).push(p);
  }

  const sections = (navCfg?.sections?.length ? navCfg.sections : Array.from(bySection.keys()).map(label => ({ label })));

  // Use a natural, case-insensitive collator for display-only sorting
  // Note: Sorting is applied at render time only; persisted user ordering is unchanged.
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  for (const sec of sections) {
    const label = sec.label;
    const items = (bySection.get(label) || [])
      .slice()
      .sort((a, b) => collator.compare(a?.title || '', b?.title || ''));
    const key = sectionKey(label);

    const li = document.createElement('li');
    li.className = 'nav-section';
    li.innerHTML = `
      <details class="nav-details" data-section="${escapeHtml(key)}" open>
        <summary class="nav-label nav-section-header">
          <span class="nav-icon">${escapeHtml(sec.icon || '')}</span>
          <span>${escapeHtml(label)}</span>
          <a class="nav-open-link" href="/section/${encodeURIComponent(key)}" data-link title="Open ${escapeHtml(label)}" aria-label="Open ${escapeHtml(label)}"></a>
        </summary>
        <ul class="nav-list"></ul>
      </details>
    `;
    const list = li.querySelector('.nav-list');
    const details = li.querySelector('details.nav-details');
    // Restore persisted open/closed state for this section
    try {
      const st = getState();
      const openMap = st?.navOpenSections || {};
      if (Object.prototype.hasOwnProperty.call(openMap, key)) {
        if (openMap[key]) details.setAttribute('open', '');
        else details.removeAttribute('open');
      }
    } catch {}
    // Persist on toggle
    details?.addEventListener('toggle', () => {
      try {
        const st = getState();
        const openMap = { ...(st?.navOpenSections || {}) };
        openMap[key] = details.open;
        updateState({ navOpenSections: openMap });
      } catch {}
    });
    // If user has groups for this section, render grouped subsections
    const { groups, pageToGroup } = getNavGroupsForSection(key);
    const hasGroups = Array.isArray(groups) && groups.length > 0;
    if (hasGroups) {
      // Group pages by groupId; sort at display time only
      const byGroup = new Map(groups.map(g => [g.id, []]));
      const ungrouped = [];
      for (const p of items) {
        const gid = pageToGroup && pageToGroup[p.id] ? pageToGroup[p.id] : null;
        if (gid && byGroup.has(gid)) byGroup.get(gid).push(p);
        else ungrouped.push(p);
      }
      // Sort groups alphabetically (case-insensitive, natural) at render time
      const sortedGroups = groups.slice().sort((a, b) => collator.compare(a?.name || '', b?.name || ''));

      // Render each group as nested details
      for (const g of sortedGroups) {
        const gi = document.createElement('li');
        // Sort pages within the group by title for display
        const pagesInGroup = (byGroup.get(g.id) || [])
          .slice()
          .sort((a, b) => collator.compare(a?.title || '', b?.title || ''));
        const count = pagesInGroup.length;
        gi.innerHTML = `
          <details class="nav-details" open>
            <summary class="nav-label">
              <span>${escapeHtml(g.name || 'Group')}</span>
              <span class="meta" style="margin-left:auto;">${count}</span>
            </summary>
            <ul class="nav-list"></ul>
          </details>
        `;
        const glist = gi.querySelector('.nav-list');
        for (const p of pagesInGroup) {
          const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
          const item = document.createElement('li');
          item.innerHTML = `<a class="nav-item" href="${href}" data-link>
            <span class="nav-text">${escapeHtml(p.title)}</span>
          </a>`;
          glist.appendChild(item);
        }
        list.appendChild(gi);
      }
      // Ungrouped at bottom (no header): render items directly under section
      // Note: Per request, do not render an "Ungrouped" group header; items still appear, sorted by title.
      const sortedUngrouped = ungrouped.slice().sort((a, b) => collator.compare(a?.title || '', b?.title || ''));
      for (const p of sortedUngrouped) {
        const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
        const item = document.createElement('li');
        item.innerHTML = `<a class="nav-item" href="${href}" data-link>
          <span class="nav-text">${escapeHtml(p.title)}</span>
        </a>`;
        list.appendChild(item);
      }
    } else {
      // Default rendering (no groups)
      for (const p of items) {
        const item = document.createElement('li');
        const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
        item.innerHTML = `<a class="nav-item" href="${href}" data-link>
          <span class="nav-text">${escapeHtml(p.title)}</span>
        </a>`;
        list.appendChild(item);
      }
    }
    // Prevent summary toggle when clicking the landing link
    const openLink = li.querySelector('.nav-open-link');
    if (openLink) openLink.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const href = openLink.getAttribute('href');
      if (href) navigate(href);
    });
    ul.appendChild(li);
  }
}

export async function refreshNav() {
  const [pages, navCfg] = await Promise.all([loadPages(), loadNavConfig()]);
  renderNavSections(pages, navCfg);
  // Append Tools items into existing Tools section (avoid duplicate)
  try { renderToolsSection(); } catch {}
  // Append user sections (from user state)
  try { renderUserSections(pages); } catch {}
}

export function renderToolsSection() {
  const ul = $('#navSections');
  if (!ul) return;
  // Find an existing Tools section rendered from nav config; if not present, create a plain one (no emoji)
  let toolsDetails = ul.querySelector('details.nav-details[data-section="tools"]');
  if (!toolsDetails) {
    const li = document.createElement('li');
    li.className = 'nav-section';
    li.innerHTML = `
      <details class="nav-details" data-section="tools" open>
        <summary class="nav-label nav-section-header">
          <span class="nav-icon"></span>
          <span>Tools</span>
          <a class="nav-open-link" href="/section/tools" data-link title="Open Tools" aria-label="Open Tools"></a>
        </summary>
        <ul class="nav-list"></ul>
      </details>
    `;
    ul.appendChild(li);
    toolsDetails = li.querySelector('details.nav-details[data-section="tools"]');
    // Restore/persist open state for Tools
    try {
      const st = getState();
      const openMap = st?.navOpenSections || {};
      if (Object.prototype.hasOwnProperty.call(openMap, 'tools')) {
        if (openMap['tools']) toolsDetails.setAttribute('open', '');
        else toolsDetails.removeAttribute('open');
      }
    } catch {}
    toolsDetails?.addEventListener('toggle', () => {
      try {
        const st = getState();
        const openMap = { ...(st?.navOpenSections || {}) };
        openMap['tools'] = toolsDetails.open;
        updateState({ navOpenSections: openMap });
      } catch {}
    });
  }
  const list = toolsDetails?.querySelector('.nav-list');
  for (const t of TOOLS) {
    const item = document.createElement('li');
    item.innerHTML = `<a class="nav-item" href="${t.path}" data-link>
      <span class="nav-text">${escapeHtml(t.name)}</span>
    </a>`;
    list.appendChild(item);
  }
}

export function renderUserSections(pages) {
  const ul = $('#navSections');
  if (!ul) return;
  const st = getState();
  const { sections } = normalizeSections(st || {});
  if (!sections.length) return;

  const pageMap = new Map(pages.map(p => [p.id, p]));
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  // Render each user-created section like a first-class section
  for (const sec of sections) {
    const rawTitle = String(sec.title || '').trim();
    const t = rawTitle.toLowerCase();
    if (!rawTitle) continue;
    // Exclude special/hidden sections
    if (t === 'enemies') continue;
    if (t === 'favorites') continue;

    const key = `u-${String(sec.id)}`;
    const label = rawTitle || 'Section';
    const items = (Array.isArray(sec.pageIds) ? sec.pageIds : [])
      .map(id => pageMap.get(id)).filter(Boolean)
      .slice()
      .sort((a, b) => collator.compare(a?.title || '', b?.title || ''));

    const li = document.createElement('li');
    li.className = 'nav-section';
    li.innerHTML = `
      <details class="nav-details" data-section="${escapeHtml(key)}" open>
        <summary class="nav-label nav-section-header">
          <span class="nav-icon">📁</span>
          <span>${escapeHtml(label)}</span>
          <a class="nav-open-link" href="/section/${encodeURIComponent(key)}" data-link title="Open ${escapeHtml(label)}" aria-label="Open ${escapeHtml(label)}"></a>
        </summary>
        <ul class="nav-list"></ul>
      </details>
    `;

    const details = li.querySelector('details.nav-details');
    const list = li.querySelector('.nav-list');

    // Restore persisted open/closed state for this section using stable id-based key
    try {
      const st2 = getState();
      const openMap = st2?.navOpenSections || {};
      if (Object.prototype.hasOwnProperty.call(openMap, key)) {
        if (openMap[key]) details.setAttribute('open', '');
        else details.removeAttribute('open');
      }
    } catch {}
    details?.addEventListener('toggle', () => {
      try {
        const st2 = getState();
        const openMap = { ...(st2?.navOpenSections || {}) };
        openMap[key] = details.open;
        updateState({ navOpenSections: openMap });
      } catch {}
    });

    // Support per-section nav groups using the same contract as core sections
    const { groups, pageToGroup } = getNavGroupsForSection(key);
    const hasGroups = Array.isArray(groups) && groups.length > 0;
    if (hasGroups) {
      const byGroup = new Map(groups.map(g => [g.id, []]));
      const ungrouped = [];
      for (const p of items) {
        const gid = pageToGroup && pageToGroup[p.id] ? pageToGroup[p.id] : null;
        if (gid && byGroup.has(gid)) byGroup.get(gid).push(p);
        else ungrouped.push(p);
      }
      const sortedGroups = groups.slice().sort((a, b) => collator.compare(a?.name || '', b?.name || ''));
      for (const g of sortedGroups) {
        const gi = document.createElement('li');
        const pagesInGroup = (byGroup.get(g.id) || [])
          .slice()
          .sort((a, b) => collator.compare(a?.title || '', b?.title || ''));
        const count = pagesInGroup.length;
        gi.innerHTML = `
          <details class="nav-details" open>
            <summary class="nav-label">
              <span>${escapeHtml(g.name || 'Group')}</span>
              <span class="meta" style="margin-left:auto;">${count}</span>
            </summary>
            <ul class="nav-list"></ul>
          </details>
        `;
        const glist = gi.querySelector('.nav-list');
        for (const p of pagesInGroup) {
          const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
          const item = document.createElement('li');
          item.innerHTML = `<a class="nav-item" href="${href}" data-link>
            <span class="nav-text">${escapeHtml(p.title)}</span>
          </a>`;
          glist.appendChild(item);
        }
        list.appendChild(gi);
      }
      const sortedUngrouped = ungrouped.slice().sort((a, b) => collator.compare(a?.title || '', b?.title || ''));
      for (const p of sortedUngrouped) {
        const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
        const item = document.createElement('li');
        item.innerHTML = `<a class="nav-item" href="${href}" data-link>
          <span class="nav-text">${escapeHtml(p.title)}</span>
        </a>`;
        list.appendChild(item);
      }
    } else {
      for (const p of items) {
        const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
        const item = document.createElement('li');
        item.innerHTML = `<a class="nav-item" href="${href}" data-link>
          <span class="nav-text">${escapeHtml(p.title)}</span>
        </a>`;
        list.appendChild(item);
      }
    }

    // Clicking the open-link navigates without toggling the summary
    const openLink = li.querySelector('.nav-open-link');
    if (openLink) openLink.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const href = openLink.getAttribute('href');
      if (href) navigate(href);
    });

    ul.appendChild(li);
  }
}
