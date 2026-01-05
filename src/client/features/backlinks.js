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
    const a = document.createElement('a');
    const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
    a.href = href;
    a.setAttribute('data-link', '');
    a.textContent = `${p.title} (${p.count})`;
    li.appendChild(a);
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
