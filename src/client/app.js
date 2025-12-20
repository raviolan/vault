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
      item.innerHTML = `<a class="nav-item" href="/page/${encodeURIComponent(p.id)}" data-link>
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
          ${pages.slice(0, 12).map(p => `<li><a href="/page/${encodeURIComponent(p.id)}" data-link>${escapeHtml(p.title)}</a> <span class="meta">(${escapeHtml(p.type)})</span></li>`).join('')}
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
  const tree = blocksToTree(blocks);
  const esc = (s) => String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

  function renderNode(n) {
    const props = parseMaybeJson(n.propsJson);
    const content = parseMaybeJson(n.contentJson);
    if (n.type === 'heading') {
      const level = Math.min(3, Math.max(1, Number(props.level || 2)));
      const tag = level === 1 ? 'h1' : (level === 2 ? 'h2' : 'h3');
      return `<${tag}>${esc(content.text || '')}</${tag}>`;
    }
    if (n.type === 'paragraph') {
      return `<p>${esc(content.text || '')}</p>`;
    }
    if (n.type === 'divider') {
      return `<hr />`;
    }
    if (n.type === 'section') {
      const title = content.title ? `<h3>${esc(content.title)}</h3>` : '';
      const kids = n.children.map(renderNode).join('\n');
      return `<div class="section">${title}<div class="section-children" style="padding-left:16px">${kids}</div></div>`;
    }
    // fallback
    return `<pre class="meta">${esc(JSON.stringify({ type: n.type, content }, null, 2))}</pre>`;
  }

  rootEl.innerHTML = tree.map(renderNode).join('\n');
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
      <h1>${escapeHtml(page.title)}</h1>
      <p class="meta">Type: ${escapeHtml(page.type)} · Updated: ${escapeHtml(page.updatedAt || page.createdAt || '')}</p>
      <div class="page-body" id="pageBlocks"></div>
    </article>
  `;
  const blocksRoot = document.getElementById('pageBlocks');
  renderBlocksReadOnly(blocksRoot, page.blocks || []);

  // Bind delete
  const btnDelete = $('#btnDeletePage');
  if (btnDelete) {
    btnDelete.onclick = () => openDeleteModal(page);
  }

  const btnEdit = $('#btnEditPage');
  if (btnEdit) {
    btnEdit.onclick = () => {
      alert('Editor is next — this skeleton is focused on clean architecture + safe updates.');
    };
  }
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
  tabs.forEach(btn => btn.addEventListener('click', () => {
    const t = btn.getAttribute('data-tab');
    show(t);
    updateState({ rightPanelTab: t });
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

// ---------- Boot ----------
async function boot() {
  $('#year').textContent = String(new Date().getFullYear());

  installLinkInterceptor();
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

boot().catch((err) => {
  console.error(err);
  const outlet = document.getElementById('outlet');
  if (outlet) outlet.innerHTML = `<section><h1>Something went wrong</h1><pre>${escapeHtml(err.stack || String(err))}</pre></section>`;
});
