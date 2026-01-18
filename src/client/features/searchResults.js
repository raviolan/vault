import { escapeHtml } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { openLinkifyTermModal } from './wikiLinks.js';
import { setBreadcrumb, setPageActionsEnabled } from '../lib/ui.js';
import { highlightHtml } from '../lib/searchHighlight.js';

export async function renderSearchResults() {
  setBreadcrumb('Search');
  setPageActionsEnabled({ canEdit: false, canDelete: false });
  const outlet = document.getElementById('outlet');
  if (!outlet) return;
  const q = new URL(window.location.href).searchParams.get('q') || '';
  outlet.innerHTML = `
    <section>
      <h1>Search</h1>
      <p class="meta">Showing results for “${escapeHtml(q)}”</p>
      <div class="row" style="margin: 10px 0;">
        <button type="button" class="chip" id="searchLinkifyBtn">Linkify “${escapeHtml(q)}”...</button>
      </div>
      <div id="searchResultsPage"></div>
    </section>
  `;
  const root = document.getElementById('searchResultsPage');
  if (!q.trim()) { root.innerHTML = '<p class="meta">Type in the search box above.</p>'; return; }
  const res = await fetchJson(`/api/search?q=${encodeURIComponent(q)}&detail=1&limit=200`);
  const results = res?.results || [];
  const btn = document.getElementById('searchLinkifyBtn');
  const pageIds = Array.isArray(results) ? results.map(r => r.id).filter(Boolean) : [];
  if (btn) {
    if (!q.trim() || !pageIds.length) btn.disabled = true;
    btn.addEventListener('click', () => {
      if (!q.trim() || !pageIds.length) return;
      openLinkifyTermModal({ term: q, pageIds });
    });
  }
  if (!results.length) { root.innerHTML = '<p class="meta">No matches.</p>'; return; }
  root.innerHTML = '<ul class="search-list"></ul>';
  const ul = root.querySelector('ul');
  for (const r of results) {
    const li = document.createElement('li');
    const href = r.slug ? `/p/${encodeURIComponent(r.slug)}` : `/page/${encodeURIComponent(r.id)}`;
    const meta = `${escapeHtml(r.type || '')} · ${escapeHtml(r.updatedAt || '')}`;
    const matches = Array.isArray(r.matches) ? r.matches : [];
    const matchRows = matches.map(m => {
      const where = (Array.isArray(m.sectionPath) && m.sectionPath.length)
        ? `In: ${m.sectionPath.map(escapeHtml).join(' › ')}`
        : '';
      const snippetHtml = highlightHtml(String(m.excerpt || ''), q);
      return `
        <div class="search-match">
          ${where ? `<div class="search-match-where meta">${where}</div>` : ''}
          <div class="search-match-snippet">${snippetHtml}</div>
        </div>`;
    }).join('');
    const more = Math.max(0, Number(r.matchCount || 0) - matches.length);
    const moreLine = more > 0 ? `<div class="meta search-match-more">and ${more} more…</div>` : '';
    li.innerHTML = `
      <a href="${href}" data-link class="search-title">${escapeHtml(r.title)}</a>
      <div class="meta">${meta}</div>
      <div class="search-matches">${matchRows || `<div class=\"search-snippet\">${escapeHtml(r.snippet || '')}</div>`}${moreLine}</div>
    `;
    ul.appendChild(li);
  }
}
