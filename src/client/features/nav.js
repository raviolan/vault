import { $, escapeHtml } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';

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

    const li = document.createElement('li');
    li.className = 'nav-section';
    li.innerHTML = `
      <details class="nav-details" open>
        <summary class="nav-label">
          <span class="nav-icon">${escapeHtml(sec.icon || '')}</span>
          <span>${escapeHtml(label)}</span>
        </summary>
        <ul class="nav-list"></ul>
      </details>
    `;
    const list = li.querySelector('.nav-list');
    for (const p of items) {
      const item = document.createElement('li');
      const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
      item.innerHTML = `<a class="nav-item" href="${href}" data-link>
        <span class="nav-text">${escapeHtml(p.title)}</span>
      </a>`;
      list.appendChild(item);
    }
    ul.appendChild(li);
  }
}

export async function refreshNav() {
  const [pages, navCfg] = await Promise.all([loadPages(), loadNavConfig()]);
  renderNavSections(pages, navCfg);
}

