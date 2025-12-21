import { fetchJson } from '../lib/http.js';

export async function renderBacklinksPanel(pageId) {
  try {
    const list = document.getElementById('backlinksList');
    const empty = document.getElementById('backlinksEmpty');
    if (!list) return; // panel may not be present
    list.innerHTML = '';
    empty && (empty.hidden = true);
    const res = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}/backlinks`);
    const links = res?.backlinks || res || [];
    if (!links || links.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    for (const p of links) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
      a.href = href;
      a.setAttribute('data-link', '');
      a.textContent = `${p.title} (${p.count})`;
      li.appendChild(a);
      list.appendChild(li);
    }
  } catch (e) {
    console.error('failed to load backlinks', e);
  }
}

