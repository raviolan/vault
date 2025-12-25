// Simple SPA router and link interceptor
import { setUiMode } from './uiMode.js';
const routes = [];
let fallbackHandler = null;
let currentCleanup = null; // optional cleanup returned by last route

export function route(pattern, handler) { routes.push({ pattern, handler }); }

export function navigate(path) {
  if (window.location.pathname === path) return;
  history.pushState({}, '', path);
  void renderRoute();
}

export async function renderRoute() {
  const path = window.location.pathname;
  // Defensive: clear UI mode before rendering any route; edit pages will re-enable.
  try { setUiMode(null); } catch {}
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) {
      // run previous cleanup if any
      try { if (typeof currentCleanup === 'function') currentCleanup(); } catch {}
      currentCleanup = null;
      const out = await r.handler({ path, params: m.groups || {}, match: m });
      if (typeof out === 'function') currentCleanup = out;
      return;
    }
  }
  if (typeof fallbackHandler === 'function') {
    // run previous cleanup if any
    try { if (typeof currentCleanup === 'function') currentCleanup(); } catch {}
    currentCleanup = null;
    const out = await fallbackHandler();
    if (typeof out === 'function') currentCleanup = out;
    return;
  }
}

export function installLinkInterceptor() {
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

export function setFallback(handler) {
  fallbackHandler = handler;
}
