// DM Vault (fresh architecture)
// - Global layout is in index.html
// - Only #outlet changes via router
import { loadState, getState, updateState } from './lib/state.js';
import * as Dashboard from './routes/dashboard.js';
import * as Tags from './routes/tags.js';
import * as Session from './routes/session.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function fetchJson(url, opts) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

// ---------- Simple router ----------
const routes = [];
function route(pattern, handler) { routes.push({ pattern, handler }); }

function navigate(path) {
  if (window.location.pathname === path) return;
  history.pushState({}, '', path);
  void renderRoute();
}

async function renderRoute() {
  const path = window.location.pathname;
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) return r.handler({ path, params: m.groups || {}, match: m });
  }
  // fallback
  return renderNotFound();
}

function installLinkInterceptor() {
  document.addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[data-link]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('mailto:')) return;
    e.preventDefault();
    navigate(href);
  });

  window.addEventListener('popstate', () => void renderRoute());
}

// ---------- UI helpers ----------
function setBreadcrumb(text) {
  const el = $('#breadcrumbText');
  if (el) el.textContent = text || '';
}

function setPageActionsEnabled({ canEdit = false, canDelete = false } = {}) {
  const btnEdit = $('#btnEditPage');
  const btnDelete = $('#btnDeletePage');
  if (btnEdit) btnEdit.disabled = !canEdit;
  if (btnDelete) btnDelete.hidden = !canDelete;
}

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

function installSearchPreview() {
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

async function renderSearchResults() {
  setBreadcrumb('Search');
  setPageActionsEnabled({ canEdit: false, canDelete: false });
  const outlet = document.getElementById('outlet');
  if (!outlet) return;
  const q = new URL(window.location.href).searchParams.get('q') || '';
  outlet.innerHTML = `
    <section>
      <h1>Search</h1>
      <p class="meta">Showing results for “${escapeHtml(q)}”</p>
      <div id="searchResultsPage"></div>
    </section>
  `;
  const root = document.getElementById('searchResultsPage');
  if (!q.trim()) { root.innerHTML = '<p class="meta">Type in the search box above.</p>'; return; }
  const res = await fetchJson(`/api/search?q=${encodeURIComponent(q)}`);
  const results = res?.results || [];
  if (!results.length) { root.innerHTML = '<p class="meta">No matches.</p>'; return; }
  root.innerHTML = '<ul class="search-list"></ul>';
  const ul = root.querySelector('ul');
  for (const r of results) {
    const li = document.createElement('li');
    const href = r.slug ? `/p/${encodeURIComponent(r.slug)}` : `/page/${encodeURIComponent(r.id)}`;
    li.innerHTML = `
      <a href="${href}" data-link class="search-title">${escapeHtml(r.title)}</a>
      <div class="meta">${escapeHtml(r.type || '')} · ${escapeHtml(r.updatedAt || '')}</div>
      <div class="search-snippet">${escapeHtml(r.snippet || '')}</div>
    `;
    ul.appendChild(li);
  }
}

function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.style.display = '';
  m.focus?.();
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.style.display = 'none';
}

function bindModalBasics(modalId) {
  const m = document.getElementById(modalId);
  if (!m) return;
  m.addEventListener('click', (e) => {
    if (e.target === m) closeModal(modalId);
  });
  $$('.modal-cancel', m).forEach(btn => btn.addEventListener('click', () => closeModal(modalId)));
}

// ---------- Data + nav ----------
let cachedPages = [];

async function loadPages() {
  cachedPages = await fetchJson('/api/pages');
  return cachedPages;
}

async function loadNavConfig() {
  try {
    return await fetchJson('/assets/nav.json');
  } catch {
    return { sections: [] };
  }
}

function sectionForType(type) {
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

function renderNavSections(pages, navCfg) {
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

async function refreshNav() {
  const [pages, navCfg] = await Promise.all([loadPages(), loadNavConfig()]);
  renderNavSections(pages, navCfg);
}

// ---------- Routes ----------
function renderDashboard() {
  setBreadcrumb('Home');
  setPageActionsEnabled({ canEdit: false, canDelete: false });

  const outlet = $('#outlet');
  if (!outlet) return;

  const pages = cachedPages.slice().sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  outlet.innerHTML = `
    <section>
      <h1>Campaign Vault</h1>
      <p class="meta">Your vault lives locally (Docker volume). Updates won’t overwrite it.</p>
    </section>

    <section>
      <h2>Recent pages</h2>
      ${pages.length ? `
        <ul>
          ${pages.slice(0, 12).map(p => {
            const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
            return `<li><a href="${href}" data-link>${escapeHtml(p.title)}</a> <span class=\"meta\">(${escapeHtml(p.type)})</span></li>`;
          }).join('')}
        </ul>
      ` : `<p class="meta">No pages yet. Click <strong>+ New</strong> to create your first page.</p>`}
    </section>
  `;
}

function parseMaybeJson(x) {
  if (!x) return {};
  if (typeof x === 'object') return x;
  try { return JSON.parse(String(x)); } catch { return {}; }
}

function blocksToTree(blocks) {
  const byId = new Map(blocks.map(b => [b.id, { ...b, children: [] }]));
  const roots = [];
  for (const b of byId.values()) {
    if (b.parentId && byId.has(b.parentId)) {
      byId.get(b.parentId).children.push(b);
    } else {
      roots.push(b);
    }
  }
  const sortFn = (a, b) => (a.sort ?? 0) - (b.sort ?? 0);
  const sortTree = (nodes) => { nodes.sort(sortFn); nodes.forEach(n => sortTree(n.children)); };
  sortTree(roots);
  return roots;
}

function renderBlocksReadOnly(rootEl, blocks) {
  if (!blocks || !blocks.length) {
    rootEl.innerHTML = '<p class="meta">Empty page</p>';
    return;
  }
  rootEl.innerHTML = '';
  const tree = blocksToTree(blocks);

  const esc = (s) => String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

  function makeNode(n, depth = 0) {
    const props = parseMaybeJson(n.propsJson);
    const content = parseMaybeJson(n.contentJson);
    if (n.type === 'heading') {
      const level = Math.min(3, Math.max(1, Number(props.level || 2)));
      const tag = level === 1 ? 'h1' : (level === 2 ? 'h2' : 'h3');
      const el = document.createElement(tag);
      el.textContent = content.text || '';
      return el;
    }
    if (n.type === 'paragraph') {
      const p = document.createElement('p');
      const txt = String(content.text || '');
      p.appendChild(buildWikiTextNodes(txt, n.id));
      return p;
    }
    if (n.type === 'divider') {
      return document.createElement('hr');
    }
    if (n.type === 'section') {
      const wrap = document.createElement('div');
      wrap.className = 'section-block';
      wrap.setAttribute('data-block-id', n.id);
      const header = document.createElement('div');
      header.className = 'section-header';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'section-toggle';
      btn.setAttribute('aria-label', 'Toggle');
      btn.textContent = props.collapsed ? '▸' : '▾';
      header.appendChild(btn);
      const title = document.createElement('span');
      title.className = 'section-title-read';
      title.textContent = content.title || '';
      header.appendChild(title);
      wrap.appendChild(header);
      const kidsWrap = document.createElement('div');
      kidsWrap.className = 'section-children';
      kidsWrap.style.paddingLeft = '16px';
      if (props.collapsed) kidsWrap.style.display = 'none';
      for (const child of n.children) {
        kidsWrap.appendChild(makeNode(child, depth + 1));
      }
      wrap.appendChild(kidsWrap);
      btn.addEventListener('click', async () => {
        try {
          const next = { ...(props || {}), collapsed: !props.collapsed };
          await apiPatchBlock(n.id, { props: next });
          props.collapsed = !props.collapsed;
          btn.textContent = props.collapsed ? '▸' : '▾';
          kidsWrap.style.display = props.collapsed ? 'none' : '';
        } catch (e) { console.error('toggle failed', e); }
      });
      return wrap;
    }
    const pre = document.createElement('pre');
    pre.className = 'meta';
    pre.textContent = JSON.stringify({ type: n.type, content }, null, 2);
    return pre;
  }

  for (const n of tree) rootEl.appendChild(makeNode(n, 0));
}

function buildWikiTextNodes(text, blockIdForLegacyReplace = null) {
  const frag = document.createDocumentFragment();
  const re = /\[\[(?:page:([0-9a-fA-F-]{36})\|([^\]]*?)|([^\]]+))\]\]/g; // [[page:<uuid>|Label]] or [[Title]]
  let lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(lastIndex, m.index);
    if (before) frag.appendChild(document.createTextNode(before));
    const [full, idPart, labelPart, legacyTitle] = m;
    if (idPart) {
      const id = idPart;
      const label = (labelPart || '').trim();
      const a = document.createElement('a');
      a.href = `/page/${encodeURIComponent(id)}`;
      a.setAttribute('data-link', '');
      a.className = 'wikilink idlink';
      a.setAttribute('data-wiki', 'id');
      a.setAttribute('data-page-id', id);
      a.textContent = label || id;
      frag.appendChild(a);
    } else {
      const title = (legacyTitle || '').trim();
      const token = m[0];
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'wikilink legacy';
      a.setAttribute('data-wiki', 'title');
      a.setAttribute('data-wiki-title', title);
      if (blockIdForLegacyReplace) a.setAttribute('data-src-block', blockIdForLegacyReplace);
      a.setAttribute('data-token', token);
      a.textContent = title;
      frag.appendChild(a);
    }
    lastIndex = re.lastIndex;
  }
  const rest = text.slice(lastIndex);
  if (rest) frag.appendChild(document.createTextNode(rest));
  return frag;
}

async function openOrCreateByTitle(title) {
  try {
    // Fresh list to avoid stale cache
    const pages = await fetchJson('/api/pages');
    const existing = pages.find(p => String(p.title) === String(title));
    if (existing) {
      const href = existing.slug ? `/p/${encodeURIComponent(existing.slug)}` : `/page/${encodeURIComponent(existing.id)}`;
      navigate(href);
      return;
    }
    const created = await fetchJson('/api/pages', { method: 'POST', body: JSON.stringify({ title: String(title), type: 'note' }) });
    await refreshNav();
    const href = created.slug ? `/p/${encodeURIComponent(created.slug)}` : `/page/${encodeURIComponent(created.id)}`;
    navigate(href);
  } catch (e) {
    console.error('open/create by title failed', e);
  }
}

async function resolveLegacyAndUpgrade(title, blockId, tokenString) {
  try {
    console.log('wiki click', { title, blockId });
    const res = await fetchJson('/api/pages/resolve', { method: 'POST', body: JSON.stringify({ title, type: 'note' }) });
    console.log('resolve response', res);
    const page = res.page || res;
    const id = page.id;
    const slug = page.slug;
    if (blockId) {
      // Locate source block text fresh from memory
      const blk = currentPageBlocks.find(b => b.id === blockId);
      const content = parseMaybeJson(blk?.contentJson);
      const text = String(content?.text || '');
      const idx = text.indexOf(tokenString);
      let newText = text;
      if (idx >= 0) {
        const upgraded = `[[page:${id}|${title}]]`;
        newText = text.slice(0, idx) + upgraded + text.slice(idx + tokenString.length);
      }
      const patched = await apiPatchBlock(blockId, { content: { ...(content || {}), text: newText } });
      console.log('patch response', patched);
      currentPageBlocks = currentPageBlocks.map(b => b.id === blockId ? { ...b, contentJson: JSON.stringify({ ...(content || {}), text: newText }) } : b);
    }
    await refreshNav();
    const href = slug ? `/p/${encodeURIComponent(slug)}` : `/page/${encodeURIComponent(id)}`;
    navigate(href);
  } catch (e) {
    console.error('legacy link resolve failed', e);
    alert('Failed to resolve link: ' + (e?.message || e));
  }
}

// ---- Edit mode state ----
let editModePageId = null; // page id currently in edit mode (null => view mode)
let currentPageBlocks = [];
const patchTimers = Object.create(null);

// ---- Slash menu (minimal) ----
let slashMenuEl = null;
let slashMenuForBlockId = null;
let slashMenuInputEl = null;
let slashMenuOnSelect = null;

function ensureSlashMenuStyles() {
  if (document.getElementById('slash-menu-styles')) return;
  const style = document.createElement('style');
  style.id = 'slash-menu-styles';
  style.textContent = `
  .slash-menu{position:absolute;z-index:1000;min-width:180px;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.3);padding:6px;margin-top:4px;}
  .slash-menu .item{padding:6px 8px;cursor:pointer;border-radius:4px;display:flex;justify-content:space-between;align-items:center;}
  .slash-menu .item:hover,.slash-menu .item[aria-selected="true"]{background:#1f2937}
  .slash-menu .hint{opacity:0.6;font-size:12px}
  `;
  document.head.appendChild(style);
}

function getSlashMenuItems() {
  return [
    { key: 'h1', label: 'Heading 1', type: 'heading', props: { level: 1 } },
    { key: 'h2', label: 'Heading 2', type: 'heading', props: { level: 2 } },
    { key: 'h3', label: 'Heading 3', type: 'heading', props: { level: 3 } },
    { key: 'p', label: 'Paragraph', type: 'paragraph', props: {} },
    { key: 'divider', label: 'Divider', type: 'divider', props: {} },
    { key: 'section', label: 'Section', type: 'section', props: { collapsed: false } },
  ];
}

function hideSlashMenu() {
  if (slashMenuEl && slashMenuEl.parentNode) slashMenuEl.parentNode.removeChild(slashMenuEl);
  slashMenuEl = null;
  slashMenuForBlockId = null;
  slashMenuInputEl = null;
  slashMenuOnSelect = null;
  document.removeEventListener('mousedown', handleGlobalMenuDismiss, true);
}

function handleGlobalMenuDismiss(e) {
  if (!slashMenuEl) return;
  if (slashMenuEl.contains(e.target)) return; // clicking inside menu
  // clicking outside -> dismiss
  hideSlashMenu();
}

function showSlashMenuForBlock(block, inputEl, filterText, onSelect) {
  ensureSlashMenuStyles();
  slashMenuOnSelect = onSelect;
  slashMenuForBlockId = block.id;
  slashMenuInputEl = inputEl;

  const items = getSlashMenuItems();
  const q = String(filterText || '').trim().replace(/^\//, '').toLowerCase();
  const filtered = items.filter(it => !q || it.key.startsWith(q) || it.label.toLowerCase().includes(q));
  if (!filtered.length) { hideSlashMenu(); return; }

  if (!slashMenuEl) {
    slashMenuEl = document.createElement('div');
    slashMenuEl.className = 'slash-menu';
    document.body.appendChild(slashMenuEl);
    document.addEventListener('mousedown', handleGlobalMenuDismiss, true);
  }

  slashMenuEl.innerHTML = filtered.map((it, idx) => `<div class="item" data-key="${it.key}" tabindex="-1" ${idx===0?'aria-selected="true"':''}>${escapeHtml(it.label)} <span class="hint">/${escapeHtml(it.key)}</span></div>`).join('');

  // Position near input
  try {
    const rect = inputEl.getBoundingClientRect();
    const top = rect.top + window.scrollY + Math.min(rect.height, 28);
    const left = rect.left + window.scrollX + 8;
    slashMenuEl.style.top = `${top}px`;
    slashMenuEl.style.left = `${left}px`;
  } catch {}

  // Click selection
  for (const child of slashMenuEl.querySelectorAll('.item')) {
    child.addEventListener('click', () => {
      const key = child.getAttribute('data-key');
      const choice = items.find(x => x.key === key);
      if (choice) {
        const rest = String(inputEl.value || '').replace(/^\s*\/[a-z0-9-]*\s*/, '');
        onSelect(choice, rest);
      }
      hideSlashMenu();
    });
  }
}

function setEditModeForPage(pageId, on) {
  editModePageId = on ? pageId : null;
}

function isEditingPage(pageId) {
  return editModePageId === pageId;
}

function parseBlock(b) {
  return {
    ...b,
    props: parseMaybeJson(b.propsJson),
    content: parseMaybeJson(b.contentJson),
  };
}

async function apiCreateBlock(pageId, { type, parentId = null, sort = 0, props = {}, content = {} }) {
  return fetchJson(`/api/pages/${encodeURIComponent(pageId)}/blocks`, {
    method: 'POST',
    body: JSON.stringify({ type, parentId, sort, props, content }),
  });
}

async function apiPatchBlock(id, patch) {
  return fetchJson(`/api/blocks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

async function apiDeleteBlock(id) {
  return fetchJson(`/api/blocks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

async function apiReorder(pageId, moves) {
  return fetchJson('/api/blocks/reorder', {
    method: 'POST',
    body: JSON.stringify({ pageId, moves }),
  });
}

function debouncePatch(blockId, patch, delay = 400) {
  clearTimeout(patchTimers[blockId]);
  patchTimers[blockId] = setTimeout(async () => {
    try {
      const updated = await apiPatchBlock(blockId, patch);
      // reconcile in-memory copy
      currentPageBlocks = currentPageBlocks.map(b => b.id === updated.id ? { ...updated } : b);
    } catch (e) {
      console.error('patch failed', e);
    }
  }, delay);
}

function renderBlocksEdit(rootEl, page, blocks) {
  currentPageBlocks = blocks.slice();
  if (!currentPageBlocks.length) {
    // Provide one empty paragraph to start typing
    const empty = document.createElement('div');
    empty.innerHTML = `<div class="block" data-block-id="" data-parent-id="">
      <textarea class="block-input" placeholder="Start typing..."></textarea>
    </div>`;
    const ta = empty.querySelector('textarea');
    ta.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: null, sort: 0, props: {}, content: { text: '' } });
        await refreshBlocksFromServer(page.id);
        renderBlocksEdit(rootEl, page, currentPageBlocks);
        focusBlockInput(created.id);
      }
    });
    rootEl.innerHTML = '';
    rootEl.appendChild(empty.firstElementChild);
    setTimeout(() => ta.focus(), 0);
    return;
  }

  rootEl.innerHTML = '';
  const tree = blocksToTree(currentPageBlocks);

  function renderNodeEdit(rawNode, depth = 0) {
    const b = parseBlock(rawNode);
    const wrap = document.createElement('div');
    wrap.className = 'block';
    wrap.setAttribute('data-block-id', b.id);
    wrap.setAttribute('data-parent-id', b.parentId || '');

    if (b.type === 'heading') {
      const level = Math.min(3, Math.max(1, Number((b.props && b.props.level) || 2)));
      const input = document.createElement('input');
      input.className = 'block-input heading';
      input.value = b.content?.text || '';
      input.placeholder = level === 1 ? 'Heading 1' : (level === 2 ? 'Heading 2' : 'Heading 3');
      wrap.appendChild(input);
      bindTextInputHandlers(page, b, input);
    } else if (b.type === 'paragraph') {
      const ta = document.createElement('textarea');
      ta.className = 'block-input paragraph';
      ta.value = b.content?.text || '';
      ta.placeholder = 'Write something...';
      wrap.appendChild(ta);
      bindTextInputHandlers(page, b, ta);
    } else if (b.type === 'divider') {
      const hr = document.createElement('hr');
      wrap.appendChild(hr);
    } else if (b.type === 'section') {
      const header = document.createElement('div');
      header.className = 'section-header';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'section-toggle';
      toggle.textContent = b.props?.collapsed ? '▸' : '▾';
      header.appendChild(toggle);
      const title = document.createElement('input');
      title.className = 'block-input section-title';
      title.placeholder = 'Section title';
      title.value = b.content?.title || '';
      header.appendChild(title);
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'chip section-add';
      addBtn.textContent = '+';
      addBtn.title = 'Add child paragraph';
      header.appendChild(addBtn);
      wrap.appendChild(header);

      const kidsWrap = document.createElement('div');
      kidsWrap.className = 'section-children';
      kidsWrap.style.paddingLeft = '16px';
      if (b.props?.collapsed) kidsWrap.style.display = 'none';
      wrap.appendChild(kidsWrap);

      toggle.addEventListener('click', async () => {
        const wasActive = document.activeElement && wrap.contains(document.activeElement);
        try {
          const next = { ...(b.props || {}), collapsed: !b.props?.collapsed };
          await apiPatchBlock(b.id, { props: next });
          await refreshBlocksFromServer(page.id);
          renderBlocksEdit(rootEl, page, currentPageBlocks);
          if (wasActive) focusBlockInput(b.id);
        } catch (e) { console.error('toggle failed', e); }
      });

      addBtn.addEventListener('click', async () => {
        try {
          const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: b.id, sort: 0, props: {}, content: { text: '' } });
          currentPageBlocks.push(created);
          await refreshBlocksFromServer(page.id);
          renderBlocksEdit(rootEl, page, currentPageBlocks);
          focusBlockInput(created.id);
        } catch (e) { console.error('add child failed', e); }
      });

      bindSectionTitleHandlers(page, b, title);

      for (const child of rawNode.children) {
        kidsWrap.appendChild(renderNodeEdit(child, depth + 1));
      }
      return wrap;
    } else {
      const pre = document.createElement('pre');
      pre.className = 'meta';
      pre.textContent = JSON.stringify({ type: b.type, content: b.content }, null, 2);
      wrap.appendChild(pre);
    }

    if (rawNode.children && rawNode.children.length) {
      const kidsWrap = document.createElement('div');
      kidsWrap.className = 'section-children';
      kidsWrap.style.paddingLeft = '16px';
      for (const child of rawNode.children) kidsWrap.appendChild(renderNodeEdit(child, depth + 1));
      wrap.appendChild(kidsWrap);
    }

    return wrap;
  }

  for (const node of tree) rootEl.appendChild(renderNodeEdit(node, 0));
}

function focusBlockInput(blockId) {
  const el = document.querySelector(`[data-block-id="${CSS.escape(blockId)}"] .block-input`);
  el?.focus();
  if (el && el.tagName === 'TEXTAREA') {
    el.selectionStart = el.selectionEnd = el.value.length;
  }
}

async function refreshBlocksFromServer(pageId) {
  const page = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}`);
  currentPageBlocks = page.blocks || [];
}

function bindTextInputHandlers(page, b, inputEl) {
  // Input change -> debounce PATCH
  inputEl.addEventListener('input', () => {
    const text = inputEl.value;
    debouncePatch(b.id, { content: { ...(b.content || {}), text } });
    maybeHandleSlashMenu(page, b, inputEl);
  });

  inputEl.addEventListener('keydown', async (e) => {
    // Slash menu keyboard control
    if (e.key === 'Escape' && slashMenuEl) {
      hideSlashMenu();
      return;
    }

    if (e.key === 'Enter' && !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) {
      if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
        e.preventDefault();
        // Create paragraph below
        const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: b.parentId ?? null, sort: Number(b.sort || 0) + 1, props: {}, content: { text: '' } });
        // Local optimistic update
        currentPageBlocks.push(created);
        const container = document.getElementById('pageBlocks');
        renderBlocksEdit(container, page, currentPageBlocks);
        focusBlockInput(created.id);
        // Background refresh to align sorts
        await refreshBlocksFromServer(page.id);
      }
    } else if (e.key === 'Backspace' && (inputEl.value || '').trim() === '') {
      if (b.type === 'paragraph') {
        e.preventDefault();
        // Find previous sibling
        const siblings = currentPageBlocks.filter(x => (x.parentId || null) === (b.parentId || null)).sort((a,b) => a.sort - b.sort);
        const idx = siblings.findIndex(x => x.id === b.id);
        const prev = idx > 0 ? siblings[idx-1] : null;
        await apiDeleteBlock(b.id).catch(() => {});
        currentPageBlocks = currentPageBlocks.filter(x => x.id !== b.id);
        const container = document.getElementById('pageBlocks');
        renderBlocksEdit(container, page, currentPageBlocks);
        if (prev) focusBlockInput(prev.id);
        await refreshBlocksFromServer(page.id);
      }
    } else if (e.key === 'Tab' && !(e.ctrlKey || e.metaKey || e.altKey)) {
      e.preventDefault();
      hideSlashMenu();
      if (e.shiftKey) {
        await outdentBlock(page, b);
      } else {
        await indentBlock(page, b);
      }
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      hideSlashMenu();
      await moveBlockWithinSiblings(page, b, e.key === 'ArrowUp' ? -1 : 1);
    }
  });

  // Manage slash menu on focus/blur
  inputEl.addEventListener('focus', () => maybeHandleSlashMenu(page, b, inputEl));
  inputEl.addEventListener('blur', () => {
    // Delay so clicks on menu can be captured
    setTimeout(() => {
      if (slashMenuForBlockId === b.id) hideSlashMenu();
    }, 150);
  });
}

function bindSectionTitleHandlers(page, b, inputEl) {
  inputEl.addEventListener('input', () => {
    const title = inputEl.value;
    debouncePatch(b.id, { content: { ...(b.content || {}), title } });
  });

  inputEl.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) {
      e.preventDefault();
      const kids = currentPageBlocks.filter(x => (x.parentId || null) === b.id).sort((a, c) => a.sort - c.sort);
      const nextSort = kids.length ? (kids[kids.length - 1].sort + 1) : 0;
      const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: b.id, sort: nextSort, props: {}, content: { text: '' } });
      currentPageBlocks.push(created);
      await refreshBlocksFromServer(page.id);
      const container = document.getElementById('pageBlocks');
      renderBlocksEdit(container, page, currentPageBlocks);
      focusBlockInput(created.id);
      return;
    }
    if (e.key === 'Tab' && !(e.ctrlKey || e.metaKey || e.altKey)) {
      e.preventDefault();
      if (e.shiftKey) {
        await outdentBlock(page, b);
      } else {
        await indentBlock(page, b);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      await moveBlockWithinSiblings(page, b, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
  });
}

function orderedBlocksFlat() {
  return currentPageBlocks.slice().sort((a,b) => ((a.parentId||'') === (b.parentId||'')) ? (a.sort - b.sort) : (String(a.parentId||'').localeCompare(String(b.parentId||'')) || (a.sort - b.sort)));
}

function siblingsOf(parentId) {
  return currentPageBlocks.filter(x => (x.parentId || null) === (parentId || null)).slice().sort((a,b) => a.sort - b.sort);
}

async function indentBlock(page, b) {
  const flat = orderedBlocksFlat();
  const idx = flat.findIndex(x => x.id === b.id);
  if (idx <= 0) return; // nothing to indent under
  const prev = flat[idx - 1];
  if (!prev) return;
  const oldParentId = b.parentId ?? null;
  const newParentId = prev.id;
  const newChildren = siblingsOf(newParentId).filter(x => x.id !== b.id);
  newChildren.push(b);
  const moves = [];
  // new parent group reindex
  newChildren.forEach((child, i) => moves.push({ id: child.id, parentId: newParentId, sort: i }));
  // old parent group reindex
  const oldSibs = siblingsOf(oldParentId).filter(x => x.id !== b.id);
  oldSibs.forEach((sib, i) => moves.push({ id: sib.id, parentId: oldParentId, sort: i }));
  await apiReorder(page.id, moves);
  await refreshBlocksFromServer(page.id);
  const container = document.getElementById('pageBlocks');
  renderBlocksEdit(container, page, currentPageBlocks);
  focusBlockInput(b.id);
}

async function outdentBlock(page, b) {
  const parent = currentPageBlocks.find(x => x.id === (b.parentId || ''));
  if (!parent) return; // already root
  const grandParentId = parent.parentId ?? null;

  const grandSibs = siblingsOf(grandParentId);
  const parentIndex = grandSibs.findIndex(x => x.id === parent.id);
  const before = grandSibs.slice(0, parentIndex + 1);
  const after = grandSibs.slice(parentIndex + 1).filter(x => x.id !== b.id);
  const newOrder = before.concat([b], after);

  const moves = [];
  newOrder.forEach((node, i) => moves.push({ id: node.id, parentId: grandParentId, sort: i }));
  // old parent group (parent loses b)
  const oldChildren = siblingsOf(parent.id).filter(x => x.id !== b.id);
  oldChildren.forEach((node, i) => moves.push({ id: node.id, parentId: parent.id, sort: i }));

  await apiReorder(page.id, moves);
  await refreshBlocksFromServer(page.id);
  const container = document.getElementById('pageBlocks');
  renderBlocksEdit(container, page, currentPageBlocks);
  focusBlockInput(b.id);
}

async function moveBlockWithinSiblings(page, b, delta) {
  const group = siblingsOf(b.parentId ?? null);
  const i = group.findIndex(x => x.id === b.id);
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= group.length) return;
  const swapped = group.slice();
  const tmp = swapped[i];
  swapped[i] = swapped[j];
  swapped[j] = tmp;
  const moves = swapped.map((node, idx) => ({ id: node.id, parentId: b.parentId ?? null, sort: idx }));
  await apiReorder(page.id, moves);
  await refreshBlocksFromServer(page.id);
  const container = document.getElementById('pageBlocks');
  renderBlocksEdit(container, page, currentPageBlocks);
  focusBlockInput(b.id);
}

function maybeHandleSlashMenu(page, b, inputEl) {
  const val = String(inputEl.value || '');
  const trimmed = val.replace(/^\s+/, '');
  if (!trimmed.startsWith('/')) { if (slashMenuForBlockId === b.id) hideSlashMenu(); return; }
  if (!(b.type === 'paragraph' || b.type === 'heading')) return;

  showSlashMenuForBlock(b, inputEl, trimmed, async (choice, restText) => {
    // Convert block
    let newType = choice.type;
    let newProps = choice.props || {};
    let newContent = {};
    if (newType === 'heading') {
      newContent = { text: restText || '' };
    } else if (newType === 'paragraph') {
      newContent = { text: restText || '' };
    } else if (newType === 'section') {
      newContent = { title: restText || '' };
    } else if (newType === 'divider') {
      newContent = {};
    }
    try {
      await apiPatchBlock(b.id, { type: newType, props: newProps, content: newContent });
      await refreshBlocksFromServer(page.id);
      const container = document.getElementById('pageBlocks');
      renderBlocksEdit(container, page, currentPageBlocks);
      if (newType === 'divider') {
        // Focus next editable input; create one if none exists
        const flat = orderedBlocksFlat();
        const idx = flat.findIndex(x => x.id === b.id);
        let next = flat[idx + 1];
        if (!next) {
          const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: b.parentId ?? null, sort: (b.sort ?? 0) + 1, props: {}, content: { text: '' } });
          await refreshBlocksFromServer(page.id);
          renderBlocksEdit(container, page, currentPageBlocks);
          focusBlockInput(created.id);
          return;
        }
        // If next isn't editable (divider), skip until editable
        let hops = 0;
        while (next && next.type === 'divider' && hops < 3) { // small safety bound
          const idx2 = flat.findIndex(x => x.id === next.id);
          next = flat[idx2 + 1];
          hops++;
        }
        if (next) focusBlockInput(next.id);
      } else {
        focusBlockInput(b.id);
      }
    } catch (err) {
      console.error('convert failed', err);
    }
  });
}

async function renderPage({ match }) {
  const id = match[1];
  const page = await fetchJson(`/api/pages/${encodeURIComponent(id)}`);

  setBreadcrumb(page.title);
  setPageActionsEnabled({ canEdit: true, canDelete: true });

  const outlet = $('#outlet');
  if (!outlet) return;

  outlet.innerHTML = `
    <article class="page">
      <h1 id="pageTitleView">${escapeHtml(page.title)}</h1>
      <p class="meta">Type: ${escapeHtml(page.type)} · Updated: ${escapeHtml(page.updatedAt || page.createdAt || '')}</p>
      <div class="page-body" id="pageBlocks"></div>
    </article>
  `;
  const blocksRoot = document.getElementById('pageBlocks');
  currentPageBlocks = page.blocks || [];
  if (isEditingPage(page.id)) {
    enablePageTitleEdit(page);
    renderBlocksEdit(blocksRoot, page, currentPageBlocks);
  } else {
    renderBlocksReadOnly(blocksRoot, currentPageBlocks);
  }

  // Populate backlinks panel for this page
  void renderBacklinksPanel(page.id);

  // Bind delete
  const btnDelete = $('#btnDeletePage');
  if (btnDelete) {
    btnDelete.onclick = () => openDeleteModal(page);
  }

  const btnEdit = $('#btnEditPage');
  if (btnEdit) {
    btnEdit.textContent = isEditingPage(page.id) ? 'Done' : 'Edit';
    btnEdit.onclick = () => {
      const now = !isEditingPage(page.id);
      setEditModeForPage(page.id, now);
      btnEdit.textContent = now ? 'Done' : 'Edit';
      if (now) {
        enablePageTitleEdit(page);
        renderBlocksEdit(blocksRoot, page, currentPageBlocks);
      } else {
        disablePageTitleEdit(page);
        renderBlocksReadOnly(blocksRoot, currentPageBlocks);
      }
    };
  }
}

async function renderPageBySlug({ match }) {
  const slug = match[1];
  const page = await fetchJson(`/api/pages/slug/${encodeURIComponent(slug)}`);

  setBreadcrumb(page.title);
  setPageActionsEnabled({ canEdit: true, canDelete: true });

  const outlet = $('#outlet');
  if (!outlet) return;

  outlet.innerHTML = `
    <article class="page">
      <h1 id="pageTitleView">${escapeHtml(page.title)}</h1>
      <p class="meta">Type: ${escapeHtml(page.type)} · Updated: ${escapeHtml(page.updatedAt || page.createdAt || '')}</p>
      <div class="page-body" id="pageBlocks"></div>
    </article>
  `;
  const blocksRoot = document.getElementById('pageBlocks');
  currentPageBlocks = page.blocks || [];
  if (isEditingPage(page.id)) {
    enablePageTitleEdit(page);
    renderBlocksEdit(blocksRoot, page, currentPageBlocks);
  } else {
    renderBlocksReadOnly(blocksRoot, currentPageBlocks);
  }

  // Bind delete
  const btnDelete = $('#btnDeletePage');
  if (btnDelete) {
    btnDelete.onclick = () => openDeleteModal(page);
  }

  const btnEdit = $('#btnEditPage');
  if (btnEdit) {
    btnEdit.textContent = isEditingPage(page.id) ? 'Done' : 'Edit';
    btnEdit.onclick = () => {
      const now = !isEditingPage(page.id);
      setEditModeForPage(page.id, now);
      btnEdit.textContent = now ? 'Done' : 'Edit';
      if (now) {
        enablePageTitleEdit(page);
        renderBlocksEdit(blocksRoot, page, currentPageBlocks);
      } else {
        disablePageTitleEdit(page);
        renderBlocksReadOnly(blocksRoot, currentPageBlocks);
      }
    };
  }

  // Backlinks
  void renderBacklinksPanel(page.id);
}

function enablePageTitleEdit(page) {
  const h1 = document.getElementById('pageTitleView');
  if (!h1) return;
  const input = document.createElement('input');
  input.id = 'pageTitleInput';
  input.className = 'page-title-input';
  input.value = page.title || '';
  h1.replaceWith(input);
  bindPageTitleInput(page, input);
}

function disablePageTitleEdit(page) {
  const input = document.getElementById('pageTitleInput');
  if (!input) return;
  const h1 = document.createElement('h1');
  h1.id = 'pageTitleView';
  h1.textContent = input.value || page.title || '';
  input.replaceWith(h1);
}

function bindPageTitleInput(page, input) {
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const newTitle = input.value;
    t = setTimeout(async () => {
      try {
        const updated = await fetchJson(`/api/pages/${encodeURIComponent(page.id)}`, { method: 'PATCH', body: JSON.stringify({ title: newTitle }) });
        page.title = updated.title || newTitle;
        setBreadcrumb(page.title);
        await refreshNav();
      } catch (e) {
        console.error('Failed to update title', e);
      }
    }, 400);
  });
}

function renderPlaceholder(title) {
  setBreadcrumb(title);
  setPageActionsEnabled({ canEdit: false, canDelete: false });
  const outlet = $('#outlet');
  if (!outlet) return;
  outlet.innerHTML = `
    <section>
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">Placeholder route. We’ll wire this module up cleanly as a mini-app.</p>
    </section>
  `;
}

function renderNotFound() {
  setBreadcrumb('Not found');
  setPageActionsEnabled({ canEdit: false, canDelete: false });
  const outlet = $('#outlet');
  if (!outlet) return;
  outlet.innerHTML = `
    <section>
      <h1>404</h1>
      <p class="meta">That page doesn’t exist.</p>
      <p><a href="/" data-link>Go home</a></p>
    </section>
  `;
}

// ---------- Modals (Create / Delete) ----------
function openCreateModal() {
  const modal = document.getElementById('createPageModal');
  if (!modal) return;
  const titleInput = modal.querySelector('input[name="pageTitle"]');
  titleInput.value = '';
  openModal('createPageModal');
  setTimeout(() => titleInput.focus(), 0);
}

async function createPageFromModal() {
  const modal = document.getElementById('createPageModal');
  const type = modal.querySelector('select[name="pageType"]').value;
  const title = modal.querySelector('input[name="pageTitle"]').value.trim();
  if (!title) return;

  const page = await fetchJson('/api/pages', {
    method: 'POST',
    body: JSON.stringify({ title, type }),
  });

  closeModal('createPageModal');
  await refreshNav();
  navigate(`/page/${encodeURIComponent(page.id)}`);
}

async function renderBacklinksPanel(pageId) {
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

function openDeleteModal(page) {
  const modal = document.getElementById('deletePageModal');
  if (!modal) return;

  modal.querySelector('.delete-page-title-label').textContent = page.title;
  const input = modal.querySelector('input[name="deleteConfirmTitle"]');
  const confirmBtn = modal.querySelector('.modal-confirm');

  input.value = '';
  confirmBtn.disabled = true;

  const onInput = () => {
    confirmBtn.disabled = input.value.trim() !== page.title;
  };
  input.oninput = onInput;

  confirmBtn.onclick = async () => {
    await fetchJson(`/api/pages/${encodeURIComponent(page.id)}`, { method: 'DELETE' });
    closeModal('deletePageModal');
    await refreshNav();
    navigate('/');
  };

  openModal('deletePageModal');
  setTimeout(() => input.focus(), 0);
}

// ---------- Right panel persistence (very light) ----------
function bindRightPanel() {
  const toggle = $('#rightDrawerToggle');
  const drawer = $('#rightDrawer');
  const pinBtn = $('#rightDrawerPin');
  if (!toggle || !drawer) return;

  // init from state
  const s = getState();
  if (s.rightPanelOpen) drawer.removeAttribute('hidden');
  else drawer.setAttribute('hidden', '');
  toggle.setAttribute('aria-expanded', String(!!s.rightPanelOpen));
  if (pinBtn) pinBtn.setAttribute('aria-pressed', String(!!s.rightPanelPinned));

  toggle.addEventListener('click', () => {
    const isHidden = drawer.hasAttribute('hidden');
    if (isHidden) {
      drawer.removeAttribute('hidden');
      toggle.setAttribute('aria-expanded', 'true');
      updateState({ rightPanelOpen: true });
    } else {
      drawer.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', 'false');
      updateState({ rightPanelOpen: false });
    }
  });

  pinBtn?.addEventListener('click', () => {
    const pressed = pinBtn.getAttribute('aria-pressed') === 'true';
    pinBtn.setAttribute('aria-pressed', String(!pressed));
    updateState({ rightPanelPinned: !pressed });
  });

  const tabs = $$('.right-panel-tabs [data-tab]');
  const panels = $$('[data-panel]');
  const show = (name) => {
    for (const p of panels) p.hidden = p.getAttribute('data-panel') !== name;
  };
  // initialize active tab
  show(s.rightPanelTab || 'notepad');
  if ((s.rightPanelTab || 'notepad') === 'settings') renderSettingsPanel();
  tabs.forEach(btn => btn.addEventListener('click', () => {
    const t = btn.getAttribute('data-tab');
    show(t);
    updateState({ rightPanelTab: t });
    if (t === 'settings') renderSettingsPanel();
  }));

  // persistence
  const notepad = $('#notepad');
  const todoInput = $('#todoInput');
  const todoAdd = $('#todoAdd');
  const todoList = $('#todoList');

  // initial values
  notepad && (notepad.value = s.notepadText || '');
  if (todoList) renderTodos(todoList, s.todoItems || []);

  // debounced updates via state store
  let notepadTimer;
  notepad?.addEventListener('input', () => {
    clearTimeout(notepadTimer);
    const val = notepad.value;
    notepadTimer = setTimeout(() => updateState({ notepadText: val }), 300);
  });

  todoAdd?.addEventListener('click', () => {
    const text = (todoInput?.value || '').trim();
    if (!text) return;
    const cur = getState().todoItems || [];
    const next = [...cur, { id: crypto.randomUUID(), text, done: false }];
    todoInput.value = '';
    renderTodos(todoList, next);
    updateState({ todoItems: next });
  });

  function renderTodos(root, todos) {
    if (!root) return;
    root.innerHTML = '';
    for (const t of todos) {
      const li = document.createElement('li');
      li.innerHTML = `
        <label style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" ${t.done ? 'checked' : ''} />
          <span>${escapeHtml(t.text)}</span>
        </label>
        <button class="chip" title="Delete">×</button>
      `;
      const cb = li.querySelector('input');
      const del = li.querySelector('button');
      cb.addEventListener('change', () => {
        t.done = cb.checked;
        updateState({ todoItems: todos });
      });
      del.addEventListener('click', () => {
        const next = (getState().todoItems || []).filter(x => x.id !== t.id);
        renderTodos(root, next);
        updateState({ todoItems: next });
      });
      root.appendChild(li);
    }
  }
}

async function renderSettingsPanel() {
  const root = document.getElementById('settingsPanel');
  if (!root) return;
  root.innerHTML = '<p class="meta">Loading…</p>';
  try {
    const meta = await fetchJson('/api/meta');
    root.innerHTML = `
      <div>
        <div class="meta">Data root</div>
        <pre style="white-space:pre-wrap">${escapeHtml(meta.dataRoot || '')}</pre>
        <div class="meta">DB path</div>
        <pre style="white-space:pre-wrap">${escapeHtml(meta.dbPath || '')}</pre>
      </div>
      <div style=\"margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;\">
        <button id=\"exportVault\" class=\"chip\">Export vault</button>
        <input id=\"importFile\" type=\"file\" accept=\".sqlite,application/octet-stream\" />
        <button id=\"importVault\" class=\"chip\">Import</button>
      </div>
      <p class=\"meta\">Import replaces your current vault. It will reload after import.</p>
    `;
    document.getElementById('exportVault')?.addEventListener('click', () => {
      window.location.href = '/api/export';
    });
    document.getElementById('importVault')?.addEventListener('click', async () => {
      const fileInput = document.getElementById('importFile');
      const f = fileInput?.files?.[0];
      if (!f) return alert('Choose a .sqlite file first');
      try {
        const buf = await f.arrayBuffer();
        const res = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
        if (!res.ok) throw new Error(await res.text());
        alert('Imported. Reloading…');
        window.location.reload();
      } catch (e) {
        console.error('import failed', e);
        alert('Import failed');
      }
    });
  } catch (e) {
    root.innerHTML = `<p class=\"meta\">Failed to load settings</p>`;
  }
}

// ---------- Boot ----------
async function boot() {
  $('#year').textContent = String(new Date().getFullYear());

  installLinkInterceptor();
  // Delegated click for wiki links (view mode)
  document.addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[data-wiki]');
    if (!a) return;
    const kind = a.getAttribute('data-wiki');
    if (kind === 'title') {
      e.preventDefault();
      e.stopPropagation();
      const title = a.getAttribute('data-wiki-title') || '';
      const blockId = a.getAttribute('data-src-block') || '';
      const token = a.getAttribute('data-token') || `[[${title}]]`;
      void resolveLegacyAndUpgrade(title, blockId, token);
    } else if (kind === 'id') {
      // let router handle (anchor has data-link)
    }
  });

  // Top search preview dropdown
  installSearchPreview();

  // Simple command palette with preview (Cmd/Ctrl+K)
  installCommandPalette();
  bindModalBasics('createPageModal');
  bindModalBasics('deletePageModal');
  // Load user state first so UI can reflect it
  await loadState();
  bindRightPanel();

  // Left panel controls + persistence
  const leftDrawer = $('#leftDrawer');
  const leftToggle = $('#leftDrawerToggle');
  const leftCollapseToggle = $('#leftCollapseExpand');
  const st = getState();
  if (st.leftPanelOpen) {
    leftDrawer?.removeAttribute('hidden');
    leftToggle?.setAttribute('aria-expanded', 'true');
  } else {
    leftDrawer?.setAttribute('hidden', '');
    leftToggle?.setAttribute('aria-expanded', 'false');
  }
  document.body.toggleAttribute('data-nav-collapsed', !!st.navCollapsed);

  leftToggle?.addEventListener('click', () => {
    const isHidden = leftDrawer?.hasAttribute('hidden');
    if (isHidden) {
      leftDrawer?.removeAttribute('hidden');
      leftToggle?.setAttribute('aria-expanded', 'true');
      updateState({ leftPanelOpen: true });
    } else {
      leftDrawer?.setAttribute('hidden', '');
      leftToggle?.setAttribute('aria-expanded', 'false');
      updateState({ leftPanelOpen: false });
    }
  });
  leftCollapseToggle?.addEventListener('click', () => {
    const now = !(getState().navCollapsed);
    document.body.toggleAttribute('data-nav-collapsed', now);
    updateState({ navCollapsed: now });
  });

  $('#btnCreatePage')?.addEventListener('click', openCreateModal);
  $('#createPageModal .modal-confirm')?.addEventListener('click', () => void createPageFromModal());

  // ESC closes any open modal (no duplication)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      for (const m of document.querySelectorAll('.modal')) {
        if (m.style.display !== 'none') m.style.display = 'none';
      }
    }
  });

  await refreshNav();

  // routes
  route(/^\/$/, () => {
    setBreadcrumb('Dashboard');
    setPageActionsEnabled({ canEdit: false, canDelete: false });
    const outlet = document.getElementById('outlet');
    Dashboard.render(outlet, {});
  });
  route(/^\/page\/([^\/]+)$/, (ctx) => renderPage(ctx));
  route(/^\/p\/([^\/]+)$/, (ctx) => renderPageBySlug(ctx));
  route(/^\/search\/?$/, () => renderSearchResults());
  route(/^\/tags\/?$/, () => {
    setBreadcrumb('Tags');
    setPageActionsEnabled({ canEdit: false, canDelete: false });
    const outlet = document.getElementById('outlet');
    Tags.render(outlet, {});
  });
  route(/^\/session\/?$/, () => {
    setBreadcrumb('Session');
    setPageActionsEnabled({ canEdit: false, canDelete: false });
    const outlet = document.getElementById('outlet');
    Session.render(outlet, {});
  });

  await renderRoute();
}

function installCommandPalette() {
  if (document.getElementById('cmdp')) return;
  const wrap = document.createElement('div');
  wrap.id = 'cmdp';
  wrap.style.display = 'none';
  wrap.innerHTML = `
    <div id="cmdpOverlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1500;"></div>
    <div id="cmdpPanel" style="position:fixed;z-index:1501;top:10%;left:50%;transform:translateX(-50%);width:720px;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:10px;box-shadow:0 16px 36px rgba(0,0,0,0.45);">
      <div style="padding:8px 10px;border-bottom:1px solid #374151"><input id="cmdpInput" placeholder="Quick open..." style="width:100%;background:#0f172a;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:8px 10px;outline:none"/></div>
      <div style="display:flex;max-height:360px;">
        <div id="cmdpList" style="flex:1;overflow:auto;padding:8px 6px"></div>
        <div id="cmdpPreview" style="width:45%;border-left:1px solid #374151;padding:8px 10px;white-space:pre-wrap;opacity:0.85"></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const overlay = document.getElementById('cmdpOverlay');
  const panel = document.getElementById('cmdpPanel');
  const input = document.getElementById('cmdpInput');
  const list = document.getElementById('cmdpList');
  const prev = document.getElementById('cmdpPreview');

  let items = [];
  let active = -1;
  let timer;

  function render() {
    list.innerHTML = items.map((it, idx) => `<div class="search-item${idx===active?' active':''}" data-id="${it.id}" data-slug="${it.slug||''}" style="padding:8px 10px;border-radius:6px;cursor:pointer;">${escapeHtml(it.title)}</div>`).join('');
    const sel = items[active];
    prev.innerHTML = sel ? `<div class="meta">${escapeHtml(sel.type||'')}</div><div class="search-snippet">${escapeHtml(sel.snippet||'')}</div>` : '<div class="meta">No selection</div>';
    list.querySelectorAll('.search-item').forEach((el, idx) => {
      el.addEventListener('mouseenter', () => { active = idx; render(); });
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', () => openActive());
    });
  }

  async function search(q) {
    const res = await fetchJson(`/api/search?q=${encodeURIComponent(q)}`);
    items = res?.results || [];
    active = items.length ? 0 : -1;
    render();
  }

  function openActive() {
    if (active >= 0 && active < items.length) {
      const it = items[active];
      const href = it.slug ? `/p/${encodeURIComponent(it.slug)}` : `/page/${encodeURIComponent(it.id)}`;
      hide();
      navigate(href);
    } else {
      const q = input.value.trim();
      hide();
      if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
    }
  }

  function show() { wrap.style.display = ''; input.value=''; items=[]; active=-1; render(); setTimeout(() => input.focus(), 0); }
  function hide() { wrap.style.display = 'none'; }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      show();
    } else if (wrap.style.display !== 'none') {
      if (e.key === 'Escape') { hide(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { active=(active+1)%items.length; render(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { active=(active-1+items.length)%items.length; render(); } }
      else if (e.key === 'Enter') { e.preventDefault(); openActive(); }
    }
  });
  overlay.addEventListener('click', () => hide());
  input.addEventListener('input', () => { clearTimeout(timer); const q=input.value.trim(); if (!q){items=[];active=-1;render();return;} timer=setTimeout(()=>void search(q), 150); });
}

boot().catch((err) => {
  console.error(err);
  const outlet = document.getElementById('outlet');
  if (outlet) outlet.innerHTML = `<section><h1>Something went wrong</h1><pre>${escapeHtml(err.stack || String(err))}</pre></section>`;
});
