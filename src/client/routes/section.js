import { escapeHtml } from '../lib/dom.js';
import { loadPages, sectionForType } from '../features/nav.js';

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

  const listHtml = filtered.length
    ? filtered.map(p => {
        const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
        return `<li><a href="${href}" data-link>${escapeHtml(p.title)}</a></li>`;
      }).join('')
    : `<li class="meta">No items yet.</li>`;

  outlet.innerHTML = `
    <section class="card">
      <h2>${escapeHtml(label)}</h2>
      <ul>${listHtml}</ul>
    </section>
  `;
}

