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

  const bySection = new Map();
  for (const p of pages) {
    const label = sectionForType(p.type);
    if (!bySection.has(label)) bySection.set(label, []);
    bySection.get(label).push(p);
  }

  const sections = (navCfg?.sections?.length ? navCfg.sections : Array.from(bySection.keys()).map(label => ({ label })));

  for (const sec of sections) {
    const label = sec.label;
    const items = (bySection.get(label) || []).slice().sort((a,b) => a.title.localeCompare(b.title));
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
      // Group pages by groupId, keep original sort order from items
      const byGroup = new Map(groups.map(g => [g.id, []]));
      const ungrouped = [];
      for (const p of items) {
        const gid = pageToGroup && pageToGroup[p.id] ? pageToGroup[p.id] : null;
        if (gid && byGroup.has(gid)) byGroup.get(gid).push(p);
        else ungrouped.push(p);
      }
      // Render each group as nested details
      for (const g of groups) {
        const gi = document.createElement('li');
        const count = (byGroup.get(g.id) || []).length;
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
        for (const p of (byGroup.get(g.id) || [])) {
          const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
          const item = document.createElement('li');
          item.innerHTML = `<a class="nav-item" href="${href}" data-link>
            <span class="nav-text">${escapeHtml(p.title)}</span>
          </a>`;
          glist.appendChild(item);
        }
        list.appendChild(gi);
      }
      // Ungrouped at bottom (collapsible, default open)
      const ui = document.createElement('li');
      ui.innerHTML = `
        <details class="nav-details" open>
          <summary class="nav-label">
            <span>Ungrouped</span>
            <span class="meta" style="margin-left:auto;">${ungrouped.length}</span>
          </summary>
          <ul class="nav-list"></ul>
        </details>
      `;
      const ulist = ui.querySelector('.nav-list');
      for (const p of ungrouped) {
        const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
        const item = document.createElement('li');
        item.innerHTML = `<a class="nav-item" href="${href}" data-link>
          <span class="nav-text">${escapeHtml(p.title)}</span>
        </a>`;
        ulist.appendChild(item);
      }
      list.appendChild(ui);
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
  // Render each user section after existing ones
  for (const sec of sections) {
    // Skip the special ENEMIES section from sidebar
    const title = String(sec.title || '').trim();
    if (title.toLowerCase() === 'enemies') continue;
    const li = document.createElement('li');
    li.className = 'nav-section';
    li.innerHTML = `
      <details class="nav-details" open>
        <summary class="nav-label nav-section-header">
          <span class="nav-icon">📁</span>
          <span>${escapeHtml(sec.title || 'Section')}</span>
        </summary>
        <ul class="nav-list"></ul>
      </details>
    `;
    // Persist open/closed state for this user section using a stable key
    const details = li.querySelector('details.nav-details');
    const key = 'user:' + (String(sec.title || 'Section').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section');
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
    const list = li.querySelector('.nav-list');
    const pageMap = new Map(pages.map(p => [p.id, p]));
    const items = (Array.isArray(sec.pageIds) ? sec.pageIds : []).map(id => pageMap.get(id)).filter(Boolean);
    for (const p of items) {
      const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
      const item = document.createElement('li');
      item.innerHTML = `<a class="nav-item" href="${href}" data-link>
        <span class="nav-text">${escapeHtml(p.title)}</span>
      </a>`;
      list.appendChild(item);
    }
    ul.appendChild(li);
  }
}
