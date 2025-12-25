import { $, $$ } from './lib/dom.js';
import { loadState, getState, updateState } from './lib/state.js';
import { route, installLinkInterceptor, renderRoute, setFallback, navigate } from './lib/router.js';
import { setBreadcrumb, setPageActionsEnabled } from './lib/ui.js';
import * as Dashboard from './routes/dashboard.js';
import * as Tags from './routes/tags.js';
import * as Session from './routes/session.js';
import * as SettingsRoute from './routes/settings.js';
import * as SectionRoute from './routes/section.js';
import { renderPage, renderPageBySlug } from './routes/pages.js';
import { renderNotFound } from './routes/system.js';
import { installSearchPreview } from './features/searchPreview.js';
import { renderSearchResults } from './features/searchResults.js';
import { installCommandPalette } from './features/commandPalette.js';
import { bindModalBasics, openCreateModal, createPageFromModal } from './features/modals.js';
import { bindRightPanel } from './features/rightPanel.js';
import { refreshNav } from './features/nav.js';
import { installWikiLinkHandler } from './features/wikiLinks.js';
import { applyTheme, applyThemeMode } from './lib/theme.js';
import { listThemes, getModeForThemeId } from './lib/themes.js';
import { mountLeftPanelBottom } from './surfaces/leftPanelBottom.js';
import { mountLeftPanelWeather } from './surfaces/leftPanelWeather.js';
import * as WeatherSettingsRoute from './routes/weatherSettings.js';
import * as EnemyGenerator from './tools/enemyGenerator/index.js';
import { renderFavorites } from './features/favorites.js';
import { initPanels } from './features/panelControls.js';
import { initGlobalShortcuts } from './features/shortcuts.js';
import { getUserState, patchUserState } from './miniapps/state.js';

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

  // Bind theme mode toggle (switch)
  const btnDark = document.getElementById('themeModeDark');
  const btnLight = document.getElementById('themeModeLight');
  const syncSwitch = () => {
    const st = getState();
    const isLight = st.themeMode === 'light';
    if (btnDark) {
      btnDark.setAttribute('aria-pressed', String(!isLight));
      btnDark.classList.toggle('active', !isLight);
    }
    if (btnLight) {
      btnLight.setAttribute('aria-pressed', String(isLight));
      btnLight.classList.toggle('active', isLight);
    }
  };
  if (btnDark && btnLight) {
    syncSwitch();
    btnDark.addEventListener('click', () => {
      updateState({ themeMode: 'dark' });
      applyThemeMode('dark', getState());
      syncSwitch();
    });
    btnLight.addEventListener('click', () => {
      updateState({ themeMode: 'light' });
      applyThemeMode('light', getState());
      syncSwitch();
    });
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
  // Core tools
  route(/^\/tools\/enemy-generator\/?$/, () => {
    setBreadcrumb('Enemy Generator');
    setPageActionsEnabled({ canEdit: false, canDelete: false });
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
    return SettingsRoute.render(outlet, {});
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
}
