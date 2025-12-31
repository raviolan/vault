import { $, $$ } from './lib/dom.js';
import { loadState, getState, updateState } from './lib/state.js';
import { applyUiPrefsToBody } from './lib/uiPrefs.js';
import { route, installLinkInterceptor, renderRoute, setFallback, navigate } from './lib/router.js';
import { setBreadcrumb, setPageActionsEnabled } from './lib/ui.js';
import { setUiMode } from './lib/uiMode.js';
import { isEditingPage, setEditModeForPage } from './lib/pageStore.js';
import { getActivePage, setActivePage } from './lib/activePage.js';
import * as Dashboard from './routes/dashboard.js';
import * as Tags from './routes/tags.js';
import * as Session from './routes/session.js';
import * as SettingsRoute from './routes/settings.js';
import * as SectionRoute from './routes/section.js';
import { renderPage, renderPageBySlug } from './routes/pages.js';
import { renderNotFound } from './routes/system.js';
import { installSearchPreview } from './features/searchPreview.js';
import { renderSearchResults } from './features/searchResults.js';
import { bindModalBasics, openCreateModal, createPageFromModal } from './features/modals.js';
import { bindRightPanel } from './features/rightPanel.js';
import { refreshNav, installNavActiveSync } from './features/nav.js';
import { installWikiLinkHandler } from './features/wikiLinks.js';
import { installOpen5eSpellFeature } from './features/open5eSpells.js';
import { installWikiLinksContextMenu } from './features/wikiLinksContextMenu.js';
import { applyTheme, applyThemeMode } from './lib/theme.js';
import { listThemes, getModeForThemeId } from './lib/themes.js';
import { setThemeMode, syncThemeButtons } from './lib/themeSwitchers.js';
import { mountLeftPanelBottom } from './surfaces/leftPanelBottom.js';
import { mountLeftPanelWeather } from './surfaces/leftPanelWeather.js';
import * as WeatherSettingsRoute from './routes/weatherSettings.js';
import * as HpRoute from './routes/hp.js';
import * as EnemyGenerator from './tools/enemyGenerator/index.js';
import { renderFavorites } from './features/favorites.js';
import { initPanels } from './features/panelControls.js';
import { initGlobalShortcuts } from './features/shortcuts.js';
import { installGlobalLightbox } from './features/lightbox.js';
import { getUserState, patchUserState } from './miniapps/state.js';
import { PartyDrawerApp } from './miniapps/partyDrawer/app.js';

export async function boot() {
  $('#year').textContent = String(new Date().getFullYear());

  installLinkInterceptor();
  setFallback(() => renderNotFound());
  installWikiLinkHandler();
  try { installWikiLinksContextMenu(); } catch {}
  // Keep the left nav in sync with current route
  try { installNavActiveSync(); } catch {}

  installSearchPreview();
  bindModalBasics('createPageModal');
  bindModalBasics('deletePageModal');
  bindModalBasics('wikilinkCreateModal');
  bindModalBasics('open5eSpellModal');
  bindModalBasics('open5eSpellDetailsModal');
  try { installOpen5eSpellFeature(); } catch {}
  await loadState();
  // Apply UI preferences on boot
  try { applyUiPrefsToBody(getState()); } catch {}
  // Apply saved theme and labels on boot, with backwards-compatible migration to themeMode/defaults
  try {
    const st = getState();
    if (st) {
      if (st.themeMode && (st.defaultLightThemeId || st.defaultDarkThemeId)) {
        applyThemeMode(st.themeMode, st);
      } else if (st.theme) {
        const mode = getModeForThemeId(st.theme);
        const patch = {
          themeMode: mode,
          defaultLightThemeId: mode === 'light' ? st.theme : (st.defaultLightThemeId || 'light'),
          defaultDarkThemeId: mode === 'dark' ? st.theme : (st.defaultDarkThemeId || 'dark'),
        };
        // Persist migration without clobbering; keep old theme key
        updateState(patch);
        applyThemeMode(patch.themeMode, { ...st, ...patch });
      }
    }
    const brand = st?.brandLabel || 'Hembränt';
    const navTitle = st?.navHeadline || 'Feywild Adventures';
    const brandLink = document.querySelector('.top .toolbar a.chip[data-link][href="/"]');
    if (brandLink) brandLink.textContent = brand;
    const navHeadline = document.querySelector('.campaign-title');
    if (navHeadline) navHeadline.textContent = navTitle;
  } catch {}
  bindRightPanel();
  // Initialize panel sizing/collapse behavior
  try { initPanels(); } catch {}
  mountLeftPanelBottom();
  mountLeftPanelWeather();
  // Global shortcuts (document-level)
  try { initGlobalShortcuts({ navigate, patchUserState, getUserState }); } catch {}
  // Global lightbox (meaningful <img> + cover backgrounds)
  try { installGlobalLightbox(); } catch {}

  // Bind theme mode toggle (switch)
  const btnDark = document.getElementById('themeModeDark');
  const btnLight = document.getElementById('themeModeLight');
  if (btnDark && btnLight) {
    syncThemeButtons();
    btnDark.addEventListener('click', () => setThemeMode('dark'));
    btnLight.addEventListener('click', () => setThemeMode('light'));
  }

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

  // Keep existing collapse-all behavior
  leftCollapseToggle?.addEventListener('click', () => {
    const now = !(getState().navCollapsed);
    document.body.toggleAttribute('data-nav-collapsed', now);
    updateState({ navCollapsed: now });
  });

  $('#btnCreatePage')?.addEventListener('click', openCreateModal);
  $('#createPageModal .modal-confirm')?.addEventListener('click', () => void createPageFromModal());

  // Centralized Edit button wiring (global + local) using active page
  // Use delegated click so dynamically-rendered local buttons work across routes

  async function onToggleEdit() {
    const ap = getActivePage();
    if (!ap?.id || !ap?.canEdit) return;

    const now = !isEditingPage(ap.id);
    setEditModeForPage(ap.id, now);
    try { setUiMode(now ? 'edit' : null); } catch {}

    if (!now) {
      try {
        // Force-save all rich blocks to persist formatting before flushing
        document.querySelectorAll('.block-rich[contenteditable="true"]').forEach((el) => {
          try { el.__vaultForceSave?.(); } catch {}
        });
      } catch {}
      try {
        const { flushDebouncedPatches } = await import('./blocks/edit/state.js');
        await flushDebouncedPatches();
      } catch {}
      try {
        const { refreshBlocksFromServer } = await import('./blocks/edit/apiBridge.js');
        await refreshBlocksFromServer(ap.id);
      } catch {}
    }
    try { window.dispatchEvent(new Event('vault:modechange')); } catch {}
    updateEditButtonState();
  }

  function updateEditButtonState() {
    const ap = getActivePage();
    const can = !!ap?.canEdit;
    const pid = ap?.id || null;
    const label = pid ? (isEditingPage(pid) ? 'Done' : 'Edit') : ((document?.body?.dataset?.mode === 'edit') ? 'Done' : 'Edit');
    const g = document.getElementById('btnEditPage');
    if (g) { g.disabled = !can; g.textContent = label; }
  }
  // Expose to activePage.js so setActivePage can request a UI refresh
  try { window.__updateEditButtonState = updateEditButtonState; } catch {}

  document.addEventListener('click', (e) => {
    const t = e.target?.closest?.('#btnEditPage');
    if (!t) return;
    e.preventDefault();
    void onToggleEdit();
  });
  window.addEventListener('vault:modechange', updateEditButtonState);
  window.addEventListener('app:route', updateEditButtonState);
  updateEditButtonState();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      for (const m of document.querySelectorAll('.modal')) {
        if (m.style.display !== 'none') m.style.display = 'none';
      }
    }
  });

  await refreshNav();
  // Render Favorites section (tools only for now)
  try { renderFavorites(); } catch {}

  // Persist expanded/collapsed state for Favorites section
  try {
    const favDetails = document.getElementById('navFav')?.closest('details.nav-details');
    if (favDetails) {
      const st2 = getState();
      const openMap = st2?.navOpenSections || {};
      const favKey = 'favorites';
      if (Object.prototype.hasOwnProperty.call(openMap, favKey)) {
        if (openMap[favKey]) favDetails.setAttribute('open', '');
        else favDetails.removeAttribute('open');
      }
      favDetails.addEventListener('toggle', () => {
        try {
          const st3 = getState();
          const map = { ...(st3?.navOpenSections || {}) };
          map[favKey] = favDetails.open;
          updateState({ navOpenSections: map });
        } catch {}
      });
    }
  } catch {}

  route(/^\/$/, () => {
    setBreadcrumb('Dashboard');
    setPageActionsEnabled({ canEdit: false, canDelete: false });
    const outlet = document.getElementById('outlet');
    Dashboard.render(outlet, {});
  });
  route(/^\/page\/([^\/]+)$/, (ctx) => renderPage(ctx));
  route(/^\/p\/([^\/]+)$/, (ctx) => renderPageBySlug(ctx));
  route(/^\/search\/?$/, () => { try { setActivePage({ id: null, slug: null, canEdit: false, kind: 'page' }); } catch {} return renderSearchResults(); });
  route(/^\/tags\/?$/, () => {
    setBreadcrumb('Tags');
    setPageActionsEnabled({ canEdit: false, canDelete: false });
    try { setActivePage({ id: null, slug: null, canEdit: false, kind: 'page' }); } catch {}
    const outlet = document.getElementById('outlet');
    Tags.render(outlet, {});
  });
  // Core tools
  route(/^\/tools\/enemy-generator\/?$/, () => {
    setBreadcrumb('Enemy Generator');
    setPageActionsEnabled({ canEdit: false, canDelete: false });
    try { setActivePage({ id: null, slug: null, canEdit: false, kind: 'page' }); } catch {}
    const outlet = document.getElementById('outlet');
    EnemyGenerator.render(outlet);
  });
  route(/^\/session\/?$/, () => {
    setBreadcrumb('Session');
    setPageActionsEnabled({ canEdit: false, canDelete: false });
    const outlet = document.getElementById('outlet');
    Session.render(outlet, {});
  });
  route(/^\/settings\/?$/, () => {
    const outlet = document.getElementById('outlet');
    try { setActivePage({ id: null, slug: null, canEdit: false, kind: 'page' }); } catch {}
    return SettingsRoute.render(outlet, {});
  });
  // Standalone HP Tracker content page
  route(/^\/apps\/hp\/?$/, () => {
    const outlet = document.getElementById('outlet');
    try { setActivePage({ id: null, slug: null, canEdit: false, kind: 'page' }); } catch {}
    return HpRoute.render(outlet, {});
  });
  route(/^\/section\/([^\/]+)\/?$/, (ctx) => {
    const outlet = document.getElementById('outlet');
    const key = ctx.match?.[1] || '';
    return SectionRoute.render(outlet, { key });
  });
  // Dedicated Weather app settings route
  route(/^\/apps\/weather\/settings\/?$/, () => {
    const outlet = document.getElementById('outlet');
    return WeatherSettingsRoute.render(outlet, {});
  });

  await renderRoute();

  // Mount global Party Drawer miniapp after initial render
  try {
    const root = document.getElementById('partyDrawerRoot');
    if (root) PartyDrawerApp.mount(root, { loadState, getState, updateState, navigate });
  } catch {}
}
