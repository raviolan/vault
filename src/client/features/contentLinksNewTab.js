import { canonicalHrefForPageId } from '../lib/pageUrl.js';
import { fetchJson } from '../lib/http.js';

// Install a capture-phase click handler that ensures any link inside #pageBlocks
// opens in a new tab, without affecting links elsewhere in the app.
export function installContentLinksNewTab() {
  // Capture-phase so we can pre-empt router and wikilink handlers when needed
  document.addEventListener('click', async (e) => {
    try {
      // Only handle simple left-clicks without modifiers
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target;
      const inContent = target?.closest?.('#pageBlocks');
      if (!inContent) return;

      const a = target?.closest?.('a[href]');
      if (!a) return;

      // Ignore legacy unresolved wikilinks that should open the resolve modal
      if (a.dataset && a.dataset.wiki === 'title') return;

      // Ignore anchors that should keep default browser behavior
      const hrefRaw = a.getAttribute('href') || '';
      const href = String(hrefRaw).trim();
      if (!href || href === '#' || href.toLowerCase().startsWith('javascript:')) return;
      if (a.hasAttribute('download')) return;

      // Prevent navigation in current tab and block other handlers immediately
      e.preventDefault();
      try { e.stopImmediatePropagation?.(); } catch {}
      e.stopPropagation();

      // Compute a synchronous destination URL
      let finalHref = href;
      const id = a.getAttribute('data-page-id');
      if (id) {
        if (!finalHref || finalHref === '#') {
          let cachedSlug = null;
          try { cachedSlug = window.__pageMetaCache?.get?.(id)?.slug || null; } catch {}
          finalHref = cachedSlug ? `/p/${encodeURIComponent(cachedSlug)}` : `/page/${encodeURIComponent(id)}`;
        }
      }
      let absUrl = finalHref;
      try { absUrl = new URL(finalHref, window.location.origin).toString(); } catch { absUrl = finalHref; }

      // Open new tab with computed URL; then null-out opener for safety
      const win = window.open(absUrl || '', '_blank');
      if (win) { try { win.opener = null; } catch {} }
      else {
        // Popup blocked: do nothing further; current tab remains
        return;
      }

      // Optionally refine to canonical slug asynchronously for id links
      if (id) {
        try {
          window.__pageMetaCache = window.__pageMetaCache || new Map();
          const better = await canonicalHrefForPageId(id, fetchJson, window.__pageMetaCache);
          let betterAbs = better;
          try { betterAbs = new URL(better, window.location.origin).toString(); } catch {}
          if (win && !win.closed && betterAbs && betterAbs !== absUrl) {
            try { win.location.replace(betterAbs); } catch { try { win.location.href = betterAbs; } catch {} }
          }
        } catch {}
      }
    } catch {
      // Never throw from global listener
    }
  }, true);
}
