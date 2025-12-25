import { escapeHtml } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { setBreadcrumb, setPageActionsEnabled } from '../lib/ui.js';
import { renderBlocksReadOnly } from '../blocks/readOnly.js';
import { renderBlocksEdit } from '../blocks/edit.js';
import { setUiMode } from '../lib/uiMode.js';
import { isEditingPage, setEditModeForPage, getCurrentPageBlocks, setCurrentPageBlocks } from '../lib/pageStore.js';
import { openDeleteModal } from '../features/modals.js';
import { renderBacklinksPanel } from '../features/backlinks.js';
import { mountSaveIndicator, unmountSaveIndicator } from '../features/saveIndicator.js';

export async function renderPage({ match }) {
  const id = match[1];
  const page = await fetchJson(`/api/pages/${encodeURIComponent(id)}`);

  setBreadcrumb(page.title);
  setPageActionsEnabled({ canEdit: true, canDelete: true });

  const outlet = document.getElementById('outlet');
  if (!outlet) return;

  outlet.innerHTML = `
    <article class="page">
      <h1 id="pageTitleView">${escapeHtml(page.title)}</h1>
      <p class="meta">Type: ${escapeHtml(page.type)} · Updated: ${escapeHtml(page.updatedAt || page.createdAt || '')}</p>
      <div id="pageTags" class="toolbar" style="margin: 6px 0;"></div>
      <div class="page-body" id="pageBlocks"></div>
    </article>
  `;
  const blocksRoot = document.getElementById('pageBlocks');
  setCurrentPageBlocks(page.blocks || []);
  if (isEditingPage(page.id)) {
    setUiMode('edit');
    enablePageTitleEdit(page);
    renderBlocksEdit(blocksRoot, page, getCurrentPageBlocks());
    // Show save status indicator while editing
    try { mountSaveIndicator(); } catch {}

    // Restructure edit layout: wrap editor fields, move meta to bottom, insert cheat sheet
    try {
      const article = outlet.querySelector('article.page');
      const titleEl = article.querySelector('#pageTitleInput');
      const metaEl = article.querySelector('p.meta');
      const tagsEl = article.querySelector('#pageTags');
      const editorWrap = document.createElement('div');
      editorWrap.className = 'page-editor';
      // Insert wrapper before the first editor element
      if (titleEl) titleEl.before(editorWrap);
      // Move elements into wrapper
      if (titleEl) editorWrap.appendChild(titleEl);
      // Cheat sheet strip under title
      const cheat = document.createElement('div');
      cheat.className = 'page-cheatsheet';
      cheat.innerHTML = `
        <div class="meta">Cheat Sheet — #Tags (e.g. #tavern #npc), [[Wikilinks]] (e.g. [[Bent Willow Tavern]]), Ctrl+Enter saves & exits</div>
      `;
      editorWrap.appendChild(cheat);
      if (tagsEl) editorWrap.appendChild(tagsEl);
      const bodyEl = article.querySelector('#pageBlocks');
      if (bodyEl) editorWrap.appendChild(bodyEl);
      // Move meta to bottom as footer (outside card)
      if (metaEl) {
        metaEl.classList.add('page-edit-meta-footer');
        editorWrap.after(metaEl);
      }
    } catch {}
  } else {
    setUiMode(null);
    renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks());
    try { unmountSaveIndicator(); } catch {}
  }

  // Populate backlinks panel for this page
  void renderBacklinksPanel(page.id);

  // Tags editor
  void renderPageTags(page.id);

  // Bind delete
  const btnDelete = document.getElementById('btnDeletePage');
  if (btnDelete) {
    btnDelete.onclick = () => openDeleteModal(page);
  }

  const btnEdit = document.getElementById('btnEditPage');
  if (btnEdit) {
    btnEdit.textContent = isEditingPage(page.id) ? 'Done' : 'Edit';
    btnEdit.onclick = () => {
      const now = !isEditingPage(page.id);
      setEditModeForPage(page.id, now);
      btnEdit.textContent = now ? 'Done' : 'Edit';
      if (now) {
        setUiMode('edit');
        enablePageTitleEdit(page);
        renderBlocksEdit(blocksRoot, page, getCurrentPageBlocks());
        try { mountSaveIndicator(); } catch {}
      } else {
        setUiMode(null);
        disablePageTitleEdit(page);
        renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks());
        try { unmountSaveIndicator(); } catch {}
      }
    };
  }

  // Cleanup on route change: ensure we exit edit mode styles/indicator
  return () => { try { setUiMode(null); } catch {} try { unmountSaveIndicator(); } catch {} };
}

export async function renderPageBySlug({ match }) {
  const slug = match[1];
  const page = await fetchJson(`/api/pages/slug/${encodeURIComponent(slug)}`);

  setBreadcrumb(page.title);
  setPageActionsEnabled({ canEdit: true, canDelete: true });

  const outlet = document.getElementById('outlet');
  if (!outlet) return;

  outlet.innerHTML = `
    <article class="page">
      <h1 id="pageTitleView">${escapeHtml(page.title)}</h1>
      <p class="meta">Type: ${escapeHtml(page.type)} · Updated: ${escapeHtml(page.updatedAt || page.createdAt || '')}</p>
      <div class="page-body" id="pageBlocks"></div>
    </article>
  `;
  const blocksRoot = document.getElementById('pageBlocks');
  setCurrentPageBlocks(page.blocks || []);
  if (isEditingPage(page.id)) {
    setUiMode('edit');
    enablePageTitleEdit(page);
    renderBlocksEdit(blocksRoot, page, getCurrentPageBlocks());
    try { mountSaveIndicator(); } catch {}
    // Restructure edit layout in slug route as well
    try {
      const article = outlet.querySelector('article.page');
      const titleEl = article.querySelector('#pageTitleInput');
      const metaEl = article.querySelector('p.meta');
      const editorWrap = document.createElement('div');
      editorWrap.className = 'page-editor';
      if (titleEl) titleEl.before(editorWrap);
      if (titleEl) editorWrap.appendChild(titleEl);
      const cheat = document.createElement('div');
      cheat.className = 'page-cheatsheet';
      cheat.innerHTML = `<div class="meta">Cheat Sheet — #Tags, [[Wikilinks]], Ctrl+Enter saves & exits</div>`;
      editorWrap.appendChild(cheat);
      const bodyEl = article.querySelector('#pageBlocks');
      if (bodyEl) editorWrap.appendChild(bodyEl);
      if (metaEl) { metaEl.classList.add('page-edit-meta-footer'); editorWrap.after(metaEl); }
    } catch {}
  } else {
    setUiMode(null);
    renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks());
    try { unmountSaveIndicator(); } catch {}
  }

  // Bind delete
  const btnDelete = document.getElementById('btnDeletePage');
  if (btnDelete) {
    btnDelete.onclick = () => openDeleteModal(page);
  }

  const btnEdit = document.getElementById('btnEditPage');
  if (btnEdit) {
    btnEdit.textContent = isEditingPage(page.id) ? 'Done' : 'Edit';
    btnEdit.onclick = () => {
      const now = !isEditingPage(page.id);
      setEditModeForPage(page.id, now);
      btnEdit.textContent = now ? 'Done' : 'Edit';
      if (now) {
        setUiMode('edit');
        enablePageTitleEdit(page);
        renderBlocksEdit(blocksRoot, page, getCurrentPageBlocks());
        try { mountSaveIndicator(); } catch {}
      } else {
        setUiMode(null);
        disablePageTitleEdit(page);
        renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks());
        try { unmountSaveIndicator(); } catch {}
      }
    };
  }

  // Backlinks
  void renderBacklinksPanel(page.id);

  // Cleanup on route change
  return () => { try { setUiMode(null); } catch {} try { unmountSaveIndicator(); } catch {} };
}

export function enablePageTitleEdit(page) {
  const h1 = document.getElementById('pageTitleView');
  if (!h1) return;
  const input = document.createElement('input');
  input.id = 'pageTitleInput';
  input.className = 'page-title-input';
  input.value = page.title || '';
  h1.replaceWith(input);
  bindPageTitleInput(page, input);
}

export function disablePageTitleEdit(page) {
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
        await import('../features/nav.js').then(m => m.refreshNav());
      } catch (e) {
        console.error('Failed to update title', e);
      }
    }, 400);
  });
}

async function renderPageTags(pageId) {
  const container = document.getElementById('pageTags');
  if (!container) return;
  let current = [];
  try {
    const { tags } = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}/tags`);
    current = Array.isArray(tags) ? tags.slice() : [];
  } catch {}

  container.innerHTML = `
    <div id="pageTagList" style="display:inline-flex; gap: 6px; flex-wrap: wrap;"></div>
    <input id="pageTagInput" placeholder="Add tag" style="margin-left:8px; padding:4px 6px; width: 160px;" />
  `;

  const listEl = document.getElementById('pageTagList');
  const inputEl = document.getElementById('pageTagInput');

  function renderChips() {
    listEl.innerHTML = current.map((t, idx) => `
      <span class="chip" data-idx="${idx}">${t} <button title="Remove" data-remove="${idx}" class="chip" style="margin-left:4px;">×</button></span>
    `).join('');
    listEl.querySelectorAll('button[data-remove]').forEach(btn => {
      btn.onclick = async () => {
        const i = Number(btn.getAttribute('data-remove'));
        current.splice(i, 1);
        await save();
        renderChips();
      };
    });
  }

  async function save() {
    try {
      const resp = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tags: current })
      });
      current = Array.isArray(resp.tags) ? resp.tags.slice() : [];
    } catch (e) {
      console.error('Failed to save tags', e);
    }
  }

  inputEl.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const v = inputEl.value.trim();
      if (v) {
        current.push(v);
        inputEl.value = '';
        await save();
        renderChips();
      }
      e.preventDefault();
      return;
    }
    if (e.key === 'Backspace' && !inputEl.value && current.length) {
      current.pop();
      await save();
      renderChips();
      e.preventDefault();
    }
  });

  renderChips();
}

// Save and exit editing: flush debounced block patches, persist title if editing,
// then exit edit mode using the same path as clicking the Done button.
export async function saveAndExitEditing() {
  const btnEdit = document.getElementById('btnEditPage');
  if (!btnEdit) return;
  const isEditing = (btnEdit.textContent || '').trim().toLowerCase() === 'done';
  if (!isEditing) return;

  // Persist current title immediately if title input is active
  const input = document.getElementById('pageTitleInput');
  if (input) {
    const newTitle = input.value;
    // Try to infer page id from current URL (/page/:id or /p/:slug -> PATCH only when id route)
    // We patch title optimistically via existing endpoint if possible; otherwise let debounce finalize later.
    try {
      const m = window.location.pathname.match(/^\/page\/([^/]+)$/);
      if (m) {
        await fetchJson(`/api/pages/${encodeURIComponent(m[1])}`, { method: 'PATCH', body: JSON.stringify({ title: newTitle }) });
      }
    } catch (e) { console.error('Failed immediate title save', e); }
  }

  // Flush debounced block patches if available
  try { await import('../blocks/edit/state.js').then(m => m.flushDebouncedPatches && m.flushDebouncedPatches()); } catch {}

  // Exit edit mode by reusing the existing button handler
  try { btnEdit.click(); } catch {}
}
