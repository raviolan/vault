import { escapeHtml } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { navigate } from '../lib/router.js';
import { setActivePage } from '../lib/activePage.js';
import { buildEmbeddedPageHref, buildWorkspaceHref, readWorkspaceState } from '../lib/workspace.js';
import { openWorkspacePicker } from '../features/workspacePicker.js';

async function loadPages(pageIds) {
  const results = await Promise.all(pageIds.map(async (id) => {
    try {
      return await fetchJson(`/api/pages/${encodeURIComponent(id)}`);
    } catch {
      return null;
    }
  }));
  return results.filter(Boolean);
}

function renderShell(container, pages, activeId) {
  container.innerHTML = `
    <section class="workspace-route">
      <div class="workspace-strip">
        <div class="workspace-tabs" id="workspaceTabs">
          ${pages.map((page) => `
            <div class="chip workspace-tab ${String(page.id) === String(activeId) ? 'is-active' : ''}">
              <button type="button" class="workspace-tab-focus" data-workspace-focus="${escapeHtml(page.id)}">
                <span>${escapeHtml(page.title || 'Untitled')}</span>
              </button>
              <button type="button" class="workspace-tab-close" data-workspace-close="${escapeHtml(page.id)}" aria-label="Close ${escapeHtml(page.title || 'page')}">×</button>
            </div>
          `).join('')}
        </div>
        <button type="button" class="chip" id="workspaceAddPage">Add Page</button>
      </div>
      <div class="workspace-panes" id="workspacePanes">
        ${pages.map((page) => `
          <section class="workspace-pane ${String(page.id) === String(activeId) ? 'is-active' : ''}" id="workspace-pane-${escapeHtml(page.id)}" data-workspace-pane="${escapeHtml(page.id)}">
            <header class="workspace-pane-header">
              <div>
                <strong>${escapeHtml(page.title || 'Untitled')}</strong>
                <div class="meta">${escapeHtml(page.type || '')}</div>
              </div>
              <a class="chip" href="${escapeHtml(buildEmbeddedPageHref(page).replace('?embed=1', ''))}" data-link>Open Normally</a>
            </header>
            <iframe class="workspace-frame" src="${escapeHtml(buildEmbeddedPageHref(page))}" title="${escapeHtml(page.title || 'Untitled')}"></iframe>
          </section>
        `).join('')}
      </div>
    </section>
  `;
}

function nextActiveId(pageIds, closingId, currentActiveId) {
  if (String(currentActiveId) !== String(closingId)) return currentActiveId;
  const idx = pageIds.findIndex((id) => String(id) === String(closingId));
  return pageIds[idx + 1] || pageIds[idx - 1] || '';
}

export async function render(container) {
  const { pageIds, activeId } = readWorkspaceState();
  setActivePage({ id: null, slug: null, canEdit: false, kind: 'page' });
  if (!pageIds.length) {
    container.innerHTML = `
      <section class="workspace-route">
        <div class="card">
          <h1>Workspace</h1>
          <p class="meta">Open two or more pages side by side for independent scrolling and editing.</p>
          <button type="button" class="chip" id="workspaceAddFirstPage">Add Page</button>
        </div>
      </section>
    `;
    container.querySelector('#workspaceAddFirstPage')?.addEventListener('click', () => {
      openWorkspacePicker({
        title: 'Add a page to the workspace',
        onPick(page) {
          navigate(buildWorkspaceHref([page.id], page.id));
        },
      });
    });
    return;
  }

  const pages = await loadPages(pageIds);
  if (!pages.length) {
    navigate('/'); 
    return;
  }
  const safeActiveId = pages.some((page) => String(page.id) === String(activeId)) ? activeId : pages[0].id;
  renderShell(container, pages, safeActiveId);

  const tabsEl = container.querySelector('#workspaceTabs');
  const panesEl = container.querySelector('#workspacePanes');
  const pageIdList = pages.map((page) => page.id);

  tabsEl?.addEventListener('click', (event) => {
    const closeBtn = event.target.closest('[data-workspace-close]');
    if (closeBtn) {
      event.preventDefault();
      event.stopPropagation();
      const closingId = String(closeBtn.getAttribute('data-workspace-close') || '');
      const nextIds = pageIdList.filter((id) => String(id) !== closingId);
      if (!nextIds.length) {
        navigate('/');
        return;
      }
      navigate(buildWorkspaceHref(nextIds, nextActiveId(pageIdList, closingId, safeActiveId)));
      return;
    }
    const tabBtn = event.target.closest('[data-workspace-focus]');
    if (!tabBtn) return;
    const nextActive = String(tabBtn.getAttribute('data-workspace-focus') || '');
    navigate(buildWorkspaceHref(pageIdList, nextActive));
  });

  panesEl?.querySelectorAll('[data-workspace-pane]').forEach((pane) => {
    pane.addEventListener('click', () => {
      const nextActive = pane.getAttribute('data-workspace-pane') || '';
      if (String(nextActive) === String(safeActiveId)) return;
      navigate(buildWorkspaceHref(pageIdList, nextActive));
    });
  });

  container.querySelector('#workspaceAddPage')?.addEventListener('click', () => {
    openWorkspacePicker({
      title: 'Add another page to the workspace',
      excludePageIds: pageIdList,
      onPick(page) {
        navigate(buildWorkspaceHref([...pageIdList, page.id], page.id));
      },
    });
  });
}
