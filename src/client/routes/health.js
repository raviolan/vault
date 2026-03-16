import { fetchJson } from '../lib/http.js';
import { canonicalPageHref } from '../lib/pageUrl.js';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderCards(summary) {
  const cards = [
    { label: 'Active pages', value: summary.totalPages },
    { label: 'Archived pages', value: summary.archivedPages },
    { label: 'Pages with issues', value: summary.pagesWithIssues },
    { label: 'Date coverage', value: summary.dateCoverage === 'pending' ? 'Pending' : 'Ready' },
  ];
  return cards.map(card => `
    <div class="card" style="padding:10px 12px; min-width:160px;">
      <div class="meta">${escapeHtml(card.label)}</div>
      <div style="font-size:24px; margin-top:4px;">${escapeHtml(card.value)}</div>
    </div>
  `).join('');
}

function renderCategory(category) {
  const items = Array.isArray(category.items) ? category.items : [];
  const list = items.length
    ? `<ul class="health-list" style="display:flex; flex-direction:column; gap:8px; margin:10px 0 0; padding:0; list-style:none;">
        ${items.map(item => {
          const href = item.href || (item.kind === 'page' ? canonicalPageHref(item) : '#');
          const label = escapeHtml(item.label || 'Untitled');
          const meta = item.meta ? `<div class="meta">${escapeHtml(item.meta)}</div>` : '';
          return `<li>
            <a href="${escapeHtml(href)}" data-link>${label}</a>
            ${meta}
          </li>`;
        }).join('')}
      </ul>`
    : '<div class="meta" style="margin-top:10px;">No issues in this category.</div>';
  const action = category.href
    ? `<a class="chip" href="${escapeHtml(category.href)}" data-link>${category.key === 'pagesWithoutTags' || category.key === 'suspiciousTags' ? 'Open Tag Inspector' : (category.key === 'unresolvedLinks' || category.key === 'orphans' ? 'Open Cleanup' : 'Open')}</a>`
    : '';
  return `
    <section class="card" style="padding:12px;">
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <h2 style="margin:0; flex:1 1 auto;">${escapeHtml(category.label)}</h2>
        <span class="chip">${escapeHtml(category.count)}</span>
        ${action}
      </div>
      <div class="meta" style="margin-top:6px;">${escapeHtml(category.description || '')}</div>
      ${list}
    </section>
  `;
}

export async function render(container) {
  container.innerHTML = `
    <section>
      <h1>Health</h1>
      <p class="meta" style="max-width:70ch;">Content quality overview built on top of Tag Inspector and Cleanup. Use this route to spot what needs attention, then jump into the focused tools to fix it.</p>
      <div id="healthCards" style="display:flex; gap:10px; flex-wrap:wrap; margin: 10px 0 14px;"></div>
      <div class="card" style="padding:12px; margin-bottom:14px;">
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <strong>Coverage notes</strong>
          <a class="chip" href="/tags" data-link>Tag Inspector</a>
          <a class="chip" href="/cleanup" data-link>Cleanup</a>
        </div>
        <div class="meta" style="margin-top:8px;">Date completeness is intentionally marked pending until the vault has a real date model. This dashboard does not invent one.</div>
      </div>
      <div id="healthGrid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:12px;"></div>
    </section>
  `;

  const cardsEl = document.getElementById('healthCards');
  const gridEl = document.getElementById('healthGrid');
  try {
    const data = await fetchJson('/api/content-health');
    const summary = data?.summary || {};
    const categories = Array.isArray(data?.categories) ? data.categories : [];
    cardsEl.innerHTML = renderCards(summary);
    gridEl.innerHTML = categories.map(renderCategory).join('');
  } catch (e) {
    console.error('Failed to load health dashboard', e);
    cardsEl.innerHTML = '';
    gridEl.innerHTML = `<div class="meta">Failed to load health dashboard.</div>`;
  }
}
