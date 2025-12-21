import { $, $$ } from './lib/dom.js';
import { loadState, getState, updateState } from './lib/state.js';
import { route, installLinkInterceptor, renderRoute, setFallback } from './lib/router.js';
import { setBreadcrumb, setPageActionsEnabled } from './lib/ui.js';
import * as Dashboard from './routes/dashboard.js';
import * as Tags from './routes/tags.js';
import * as Session from './routes/session.js';
import { renderPage, renderPageBySlug } from './routes/pages.js';
import { renderNotFound } from './routes/system.js';
import { installSearchPreview } from './features/searchPreview.js';
import { renderSearchResults } from './features/searchResults.js';
import { installCommandPalette } from './features/commandPalette.js';
import { bindModalBasics, openCreateModal, createPageFromModal } from './features/modals.js';
import { bindRightPanel } from './features/rightPanel.js';
import { refreshNav } from './features/nav.js';
import { installWikiLinkHandler } from './features/wikiLinks.js';

export async function boot() {
  $('#year').textContent = String(new Date().getFullYear());

  installLinkInterceptor();
  setFallback(() => renderNotFound());
  installWikiLinkHandler();

  installSearchPreview();
  installCommandPalette();
  bindModalBasics('createPageModal');
  bindModalBasics('deletePageModal');
  await loadState();
  bindRightPanel();

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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      for (const m of document.querySelectorAll('.modal')) {
        if (m.style.display !== 'none') m.style.display = 'none';
      }
    }
  });

  await refreshNav();

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
