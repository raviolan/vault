import { escapeHtml, $ } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { navigate } from '../lib/router.js';

let hotkeyInstalled = false;

function ensureSearchStyles() {
  if (document.getElementById('search-styles')) return;
  const style = document.createElement('style');
  style.id = 'search-styles';
  style.textContent = `
    /* Container anchored to #searchBox */
    #searchResults.search-drop{position:absolute;z-index:1000;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow-2, 0 12px 28px rgba(0,0,0,0.28));padding:6px;margin-top:6px;opacity:1;backdrop-filter:none;pointer-events:auto;box-sizing:border-box;overflow-x:hidden}
    .search-drop{display:flex;gap:0;}
    .search-drop-list{flex:1;min-width:0;max-height:420px;overflow:auto;padding:2px;box-sizing:border-box}
    .search-drop-preview{width:45%;border-left:1px solid var(--border);padding:8px 10px;white-space:pre-wrap;color:var(--text);opacity:1;box-sizing:border-box;overflow-x:hidden}
    @media (max-width: 720px){ .search-drop-preview{display:none} }
    .search-item{padding:8px 10px;border-radius:8px;cursor:pointer}
    .search-item.active{background:color-mix(in srgb, var(--highlight, var(--accent)) 18%, transparent)}
    .search-title{font-weight:700;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    /* Support either class name for snippet */
    .search-snippet,.search-secondary{color:var(--muted);font-size:12px;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .search-meta{color:var(--muted);font-size:12px;margin-bottom:6px}
  `;
  document.head.appendChild(style);
}

export function installSearchPreview() {
  ensureSearchStyles();
  const input = document.getElementById('searchBox');
  const dropdown = document.getElementById('searchResults');
  if (!input || !dropdown) return;
  // Ensure we don't inherit hovercard constraints (max-width, pointer-events)
  dropdown.classList.remove('hovercard');
  dropdown.classList.add('search-drop');
  dropdown.style.display = 'none';

  // Ensure inner two-pane structure exists on demand
  function ensureStructure() {
    if (!dropdown.firstChild || !dropdown.querySelector('.search-drop')) {
      dropdown.innerHTML = `<div class="search-drop"><div class="search-drop-list"></div><div class="search-drop-preview"></div></div>`;
    }
  }

  let timer = null;
  let items = [];
  let activeIndex = -1;
  let searchSeq = 0;

  function positionDropdown() {
    try {
      const r = input.getBoundingClientRect();
      const vw = document.documentElement.clientWidth || window.innerWidth;
      let width = Math.max(560, r.width);
      width = Math.min(780, width);
      width = Math.min(width, vw - 24);
      let left = r.left;
      if (left + width > vw - 12) {
        left = Math.max(12, vw - 12 - width);
      }
      dropdown.classList.add('search-drop');
      dropdown.style.position = 'absolute';
      dropdown.style.top = `${r.bottom + window.scrollY}px`;
      dropdown.style.left = `${left + window.scrollX}px`;
      dropdown.style.width = `${width}px`;
    } catch {}
  }

  function renderPreviewPane() {
    ensureStructure();
    const prev = dropdown.querySelector('.search-drop-preview');
    const sel = items[activeIndex];
    if (!prev) return;
    if (!sel) {
      prev.innerHTML = `<div class="search-meta">No selection</div>`;
      return;
    }
    const metaBits = [];
    if (sel.type) metaBits.push(escapeHtml(String(sel.type)));
    if (sel.updatedAt) metaBits.push(new Date(sel.updatedAt).toLocaleDateString());
    const meta = metaBits.length ? `<div class="search-meta">${metaBits.join(' · ')}</div>` : '';
    const ctxTitle = sel.contextTitle ? `<div class="search-title">${escapeHtml(sel.contextTitle)}</div>` : '';
    const body = sel.contextText ? sel.contextText : (sel.snippet || '');
    prev.innerHTML = `${meta}${ctxTitle}<div class="search-secondary" style="white-space:pre-wrap">${escapeHtml(body)}</div>`;
  }

  function renderList() {
    ensureStructure();
    const list = dropdown.querySelector('.search-drop-list');
    if (!list) return;
    list.innerHTML = items.map((it, idx) => {
      const cls = `search-item${idx===activeIndex?' active':''}`;
      const secondary = it.contextTitle || it.snippet || '';
      return `<div class="${cls}" data-id="${it.id}" data-slug="${it.slug||''}">\n        <span class="search-title">${escapeHtml(it.title)}</span>\n        <span class="search-secondary">${escapeHtml(secondary)}</span>\n      </div>`;
    }).join('');
    list.querySelectorAll('.search-item').forEach((el, idx) => {
      el.addEventListener('mousedown', (e) => { e.preventDefault(); });
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        const slug = el.getAttribute('data-slug') || '';
        input.value = '';
        dropdown.style.display = 'none';
        const href = slug ? `/p/${encodeURIComponent(slug)}` : `/page/${encodeURIComponent(id)}`;
        navigate(href);
      });
      el.addEventListener('mouseenter', () => {
        activeIndex = idx;
        renderPreviewPane();
        list.querySelectorAll('.search-item').forEach((n,i)=>n.classList.toggle('active', i===activeIndex));
      });
    });
  }

  function render() {
    if (!items.length) { dropdown.style.display = 'none'; return; }
    dropdown.style.display = '';
    positionDropdown();
    renderList();
    renderPreviewPane();
  }

  async function fetchSnapshots(ids) {
    if (!ids || !ids.length) return {};
    const qs = ids.map(encodeURIComponent).join(',');
    const res = await fetchJson(`/api/pages/snapshots?ids=${qs}`);
    const map = {};
    for (const s of (res?.snapshots || [])) map[s.id] = s;
    return map;
  }

  async function doSearch(q) {
    const seq = ++searchSeq;
    const res = await fetchJson(`/api/search?q=${encodeURIComponent(q)}`);
    if (seq !== searchSeq) return; // stale
    const base = (res?.results || []).slice(0, 12);
    const ids = base.map(r => r.id).filter(Boolean);
    let snapMap = {};
    try { snapMap = await fetchSnapshots(ids); } catch {}
    if (seq !== searchSeq) return; // stale
    items = base.map(it => ({ ...it, ...(snapMap[it.id] || {}) }));
    activeIndex = items.length ? 0 : -1;
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
      if (items.length) { activeIndex = (activeIndex + 1) % items.length; renderList(); renderPreviewPane(); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) { activeIndex = (activeIndex - 1 + items.length) % items.length; renderList(); renderPreviewPane(); }
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

  // Install global Cmd/Ctrl+K hotkey once: focus + select #searchBox (no modal)
  if (!hotkeyInstalled) {
    document.addEventListener('keydown', (e) => {
      const key = (e.key || '').toLowerCase();
      const isCmdK = (key === 'k') && (e.metaKey || e.ctrlKey) && !e.altKey;
      if (!isCmdK) return;

      // If any modal is visibly open, do nothing (avoid fighting dialogs)
      const modals = document.querySelectorAll('.modal');
      for (const m of modals) {
        if (m && m.style && m.style.display !== 'none') {
          return;
        }
      }

      e.preventDefault();
      try {
        input.focus();
        input.select();
        dropdown.style.display = 'none';
      } catch {}
    }, { capture: true });
    hotkeyInstalled = true;
  }
}
