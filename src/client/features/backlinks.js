import { fetchJson } from '../lib/http.js';

export async function fetchBacklinks(pageId) {
  if (!pageId) return [];
  try {
    const res = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}/backlinks`);
    const links = res?.backlinks || res || [];
    return Array.isArray(links) ? links : [];
  } catch (e) {
    console.error('failed to load backlinks', e);
    return [];
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderBacklinksInto({ listEl, emptyEl, links }) {
  if (!listEl) return;
  try { listEl.innerHTML = ''; } catch {}
  if (emptyEl) emptyEl.hidden = true;

  const arr = Array.isArray(links) ? links : [];
  if (arr.length === 0) {
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  for (const p of arr) {
    const li = document.createElement('li');
    const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
    const matches = Array.isArray(p.matches) ? p.matches : [];
    const extra = Math.max(0, Number(p.count || 0) - matches.length);
    li.style.marginBottom = '12px';
    li.innerHTML = `
      <div style="display:flex; gap:8px; align-items:baseline; flex-wrap:wrap;">
        <a href="${href}" data-link>${escapeHtml(p.title)}</a>
        <span class="meta">${escapeHtml(p.type || '')} · ${escapeHtml(String(p.count || 0))} reference${Number(p.count || 0) === 1 ? '' : 's'}</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">
        ${matches.map(match => {
          const where = Array.isArray(match.sectionPath) && match.sectionPath.length
            ? `In: ${match.sectionPath.map(escapeHtml).join(' › ')}`
            : (match.blockType === 'section' ? 'In: Section title' : (match.blockType === 'heading' ? 'In: Heading' : ''));
          return `
            <div style="padding-left:10px; border-left:2px solid var(--border);">
              ${where ? `<div class="meta">${where}</div>` : ''}
              <div class="meta" style="color:var(--text);">${escapeHtml(match.excerpt || '')}</div>
            </div>
          `;
        }).join('')}
        ${extra > 0 ? `<div class="meta" style="padding-left:10px;">and ${extra} more…</div>` : ''}
      </div>
    `;
    listEl.appendChild(li);
  }
}

// Backwards-compatible panel renderer using DOM in right panel
export async function renderBacklinksPanel(pageId) {
  try {
    const list = document.getElementById('backlinksList');
    const empty = document.getElementById('backlinksEmpty');
    if (!list) return; // panel may not be present
    try { list.innerHTML = '<li class="meta">Loading…</li>'; } catch {}
    if (empty) empty.hidden = true;
    const links = await fetchBacklinks(pageId);
    renderBacklinksInto({ listEl: list, emptyEl: empty, links });
  } catch (e) {
    console.error('failed to load backlinks', e);
  }
}
