import { fetchJson } from '../lib/http.js';
import { navigate } from '../lib/router.js';

export async function render(container, ctx = {}) {
  container.innerHTML = `
    <section>
      <h1>Tags</h1>
      <div class="tool-tabs" style="margin: 8px 0;">
        <input id="tagFilter" placeholder="Filter tags..." style="flex:1; width: 260px; padding: 6px 8px;" />
      </div>
      <div id="tagList"></div>
      <div id="tagPages"></div>
    </section>
  `;

  const tagsResp = await fetchJson('/api/tags');
  const tags = Array.isArray(tagsResp.tags) ? tagsResp.tags : [];
  const tagList = document.getElementById('tagList');
  const tagPages = document.getElementById('tagPages');
  const filter = document.getElementById('tagFilter');

  function renderList(q = '') {
    const ql = (q || '').toLowerCase();
    const filtered = !ql ? tags : tags.filter(t => t.name.toLowerCase().includes(ql));
    tagList.innerHTML = filtered.map(t => `
      <button class="chip" data-tag="${t.name}">${t.name} <span class="meta">(${t.count})</span></button>
    `).join(' ');
    Array.from(tagList.querySelectorAll('button[data-tag]')).forEach(btn => {
      btn.onclick = async () => {
        const name = btn.getAttribute('data-tag');
        await showPagesForTag(name);
      };
    });
  }

  async function showPagesForTag(tagName) {
    // Minimal client-side filter: fetch pages and check each page's tags
    tagPages.innerHTML = `<p class="meta">Loading pages for “${tagName}”...</p>`;
    const pages = await fetchJson('/api/pages');
    const out = [];
    for (const p of pages) {
      try {
        const pt = await fetchJson(`/api/pages/${encodeURIComponent(p.id)}/tags`);
        if (Array.isArray(pt.tags) && pt.tags.some(n => n.toLowerCase() === tagName.toLowerCase())) {
          out.push(p);
        }
      } catch {}
    }
    if (!out.length) {
      tagPages.innerHTML = `<p class="meta">No pages with “${tagName}”.</p>`;
    } else {
      tagPages.innerHTML = `
        <h3 class="meta">Pages tagged “${tagName}”</h3>
        <ul>
          ${out.map(p => `<li><a href="/page/${encodeURIComponent(p.id)}" data-link>${p.title}</a></li>`).join('')}
        </ul>
      `;
      // enable SPA nav inside this list
      Array.from(tagPages.querySelectorAll('[data-link]')).forEach(a => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          navigate(a.getAttribute('href'));
        });
      });
    }
  }

  filter?.addEventListener('input', () => renderList(filter.value));
  // Support deep-linking via ?tag=<name>
  const usp = new URLSearchParams(window.location.search || '');
  const initialTag = usp.get('tag');
  if (initialTag) {
    filter.value = initialTag;
    renderList(initialTag);
    await showPagesForTag(initialTag);
  } else {
    renderList('');
  }
}
