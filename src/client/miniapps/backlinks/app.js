import { fetchBacklinks, renderBacklinksInto } from '../../features/backlinks.js';
import { getCurrentPageBlocks } from '../../lib/pageStore.js';

const APP_ID = 'backlinks';

export const BacklinksApp = {
  id: APP_ID,
  title: 'Backlinks',
  surfaces: ['rightPanel'],
  mount(rootEl, ctx) {
    // Determine mount target
    const hasMount = ctx && ctx.mountEl;
    const scope = (rootEl && rootEl.querySelector) ? rootEl : document;
    const panelList = scope.querySelector('#backlinksList');
    const panelEmpty = scope.querySelector('#backlinksEmpty');

    let listEl;
    let emptyEl;
    let container;

    if (hasMount) {
      // Render inside provided mount (split overlays)
      container = ctx.mountEl;
      // Clear and prepare a simple container
      try { container.innerHTML = ''; } catch {}
      const ul = document.createElement('ul');
      const p = document.createElement('p');
      p.className = 'meta';
      p.textContent = 'No backlinks.';
      p.hidden = true;
      container.appendChild(ul);
      container.appendChild(p);
      listEl = ul;
      emptyEl = p;
    } else {
      // Use existing right-panel DOM
      listEl = panelList || null;
      emptyEl = panelEmpty || null;
    }

    if (!listEl) return () => {};

    let cancelled = false;
    let reqToken = 0;

    const setLoading = (msg = 'Loading…') => {
      try { listEl.innerHTML = `<li class="meta">${msg}</li>`; } catch {}
      if (emptyEl) emptyEl.hidden = true;
    };

    const getCurrentPageId = () => {
      try { return (getCurrentPageBlocks()[0]?.pageId) || null; } catch { return null; }
    };

    async function refresh(pageId) {
      const token = ++reqToken;
      if (!pageId) {
        if (!cancelled) {
          try { listEl.innerHTML = ''; } catch {}
          if (emptyEl) { emptyEl.textContent = 'Open a page to see backlinks.'; emptyEl.hidden = false; }
        }
        return;
      }
      setLoading();
      const links = await fetchBacklinks(pageId);
      if (cancelled || token !== reqToken) return;
      renderBacklinksInto({ listEl, emptyEl, links });
    }

    let lastPageId = ctx?.pageId || getCurrentPageId();
    void refresh(lastPageId);

    const onRoute = () => {
      const cur = getCurrentPageId();
      if (cur !== lastPageId) {
        lastPageId = cur;
        void refresh(lastPageId);
      }
    };
    try { window.addEventListener('app:route', onRoute); } catch {}

    return () => {
      cancelled = true;
      try { window.removeEventListener('app:route', onRoute); } catch {}
      if (hasMount && container) {
        try { container.innerHTML = ''; } catch {}
      }
    };
  },
  onContextChange(nextCtx) {
    try {
      // Best-effort: if host supports updateContext, we can re-fetch
      const pid = nextCtx?.pageId || null;
      // No-op here; mount keeps its own listener. Left for future hooks.
      void pid;
    } catch {}
  },
};
