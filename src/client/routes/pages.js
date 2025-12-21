import { escapeHtml } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { setBreadcrumb, setPageActionsEnabled } from '../lib/ui.js';
import { renderBlocksReadOnly } from '../blocks/readOnly.js';
import { renderBlocksEdit } from '../blocks/edit.js';
import { isEditingPage, setEditModeForPage, getCurrentPageBlocks, setCurrentPageBlocks } from '../lib/pageStore.js';
import { openDeleteModal } from '../features/modals.js';
import { renderBacklinksPanel } from '../features/backlinks.js';

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
      <div class="page-body" id="pageBlocks"></div>
    </article>
  `;
  const blocksRoot = document.getElementById('pageBlocks');
  setCurrentPageBlocks(page.blocks || []);
  if (isEditingPage(page.id)) {
    enablePageTitleEdit(page);
    renderBlocksEdit(blocksRoot, page, getCurrentPageBlocks());
  } else {
    renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks());
  }

  // Populate backlinks panel for this page
  void renderBacklinksPanel(page.id);

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
        enablePageTitleEdit(page);
        renderBlocksEdit(blocksRoot, page, getCurrentPageBlocks());
      } else {
        disablePageTitleEdit(page);
        renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks());
      }
    };
  }
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
    enablePageTitleEdit(page);
    renderBlocksEdit(blocksRoot, page, getCurrentPageBlocks());
  } else {
    renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks());
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
        enablePageTitleEdit(page);
        renderBlocksEdit(blocksRoot, page, getCurrentPageBlocks());
      } else {
        disablePageTitleEdit(page);
        renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks());
      }
    };
  }

  // Backlinks
  void renderBacklinksPanel(page.id);
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

