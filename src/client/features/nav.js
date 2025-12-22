import { $, escapeHtml } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { getState } from '../lib/state.js';
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
  // Append Tools section (core tools)
  try { renderToolsSection(); } catch {}
  // Append user sections (from user state)
  try { renderUserSections(pages); } catch {}
}

export function renderToolsSection() {
  const ul = $('#navSections');
  if (!ul) return;
  const li = document.createElement('li');
  li.className = 'nav-section';
  li.innerHTML = `
    <details class="nav-details" open>
      <summary class="nav-label">
        <span class="nav-icon">🧰</span>
        <span>Tools</span>
      </summary>
      <ul class="nav-list"></ul>
    </details>
  `;
  const list = li.querySelector('.nav-list');
  for (const t of TOOLS) {
    const item = document.createElement('li');
    item.innerHTML = `<a class="nav-item" href="${t.path}" data-link>
      <span class="nav-text">${escapeHtml(t.name)}</span>
    </a>`;
    list.appendChild(item);
  }
  ul.appendChild(li);
}

export function renderUserSections(pages) {
  const ul = $('#navSections');
  if (!ul) return;
  const st = getState();
  const { sections } = normalizeSections(st || {});
  if (!sections.length) return;
  // Render each user section after existing ones
  for (const sec of sections) {
    const li = document.createElement('li');
    li.className = 'nav-section';
    li.innerHTML = `
      <details class="nav-details" open>
        <summary class="nav-label">
          <span class="nav-icon">📁</span>
          <span>${escapeHtml(sec.title || 'Section')}</span>
        </summary>
        <ul class="nav-list"></ul>
      </details>
    `;
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
