import { escapeHtml, $ } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { navigate } from '../lib/router.js';

function ensureSearchStyles() {
  if (document.getElementById('search-styles')) return;
  const style = document.createElement('style');
  style.id = 'search-styles';
  style.textContent = `
    .search-dropdown{position:absolute;z-index:1000;min-width:380px;max-width:560px;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:8px;box-shadow:0 12px 28px rgba(0,0,0,0.35);padding:6px;margin-top:6px;}
    .search-item{padding:8px 10px;border-radius:6px;cursor:pointer}
    .search-item.active{background:#1f2937}
    .search-title{display:block;font-weight:600}
    .search-snippet{display:block;opacity:0.7;font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  `;
  document.head.appendChild(style);
}

export function installSearchPreview() {
  ensureSearchStyles();
  const input = document.getElementById('searchBox');
  const dropdown = document.getElementById('searchResults');
  if (!input || !dropdown) return;
  dropdown.classList.add('search-dropdown');
  dropdown.style.display = 'none';

  let timer = null;
  let items = [];
  let activeIndex = -1;

  function positionDropdown() {
    try {
      const r = input.getBoundingClientRect();
      dropdown.style.position = 'absolute';
      dropdown.style.top = `${r.bottom + window.scrollY}px`;
      dropdown.style.left = `${r.left + window.scrollX}px`;
      dropdown.style.width = `${r.width}px`;
    } catch {}
  }

  function render() {
    if (!items.length) { dropdown.style.display = 'none'; return; }
    dropdown.innerHTML = items.map((it, idx) => {
      const cls = `search-item${idx===activeIndex?' active':''}`;
      return `<div class="${cls}" data-id="${it.id}" data-slug="${it.slug||''}">
        <span class="search-title">${escapeHtml(it.title)}</span>
        <span class="search-snippet">${escapeHtml(it.snippet||'')}</span>
      </div>`;
    }).join('');
    dropdown.style.display = '';
    positionDropdown();
    // click handlers
    dropdown.querySelectorAll('.search-item').forEach((el, idx) => {
      el.addEventListener('mousedown', (e) => { e.preventDefault(); });
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        const slug = el.getAttribute('data-slug') || '';
        input.value = '';
        dropdown.style.display = 'none';
        const href = slug ? `/p/${encodeURIComponent(slug)}` : `/page/${encodeURIComponent(id)}`;
        navigate(href);
      });
      el.addEventListener('mouseenter', () => { activeIndex = idx; render(); });
    });
  }

  async function doSearch(q) {
    const res = await fetchJson(`/api/search?q=${encodeURIComponent(q)}`);
    items = (res?.results || []).slice(0, 8);
    activeIndex = -1;
    render();
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (!q) { dropdown.style.display = 'none'; return; }
    timer = setTimeout(() => void doSearch(q), 150);
  });

  input.addEventListener('keydown', (e) => {
    if (dropdown.style.display === 'none') {
      if (e.key === 'Enter') {
        const q = input.value.trim();
        if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length) { activeIndex = (activeIndex + 1) % items.length; render(); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) { activeIndex = (activeIndex - 1 + items.length) % items.length; render(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < items.length) {
        const it = items[activeIndex];
        input.value = '';
        dropdown.style.display = 'none';
        const href = it.slug ? `/p/${encodeURIComponent(it.slug)}` : `/page/${encodeURIComponent(it.id)}`;
        navigate(href);
      } else {
        const q = input.value.trim();
        if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target === input) return;
    if (!dropdown.contains(e.target)) dropdown.style.display = 'none';
  });
}

