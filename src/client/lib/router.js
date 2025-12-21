// Simple SPA router and link interceptor
const routes = [];
let fallbackHandler = null;

export function route(pattern, handler) { routes.push({ pattern, handler }); }

export function navigate(path) {
  if (window.location.pathname === path) return;
  history.pushState({}, '', path);
  void renderRoute();
}

export async function renderRoute() {
  const path = window.location.pathname;
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) return r.handler({ path, params: m.groups || {}, match: m });
  }
  if (typeof fallbackHandler === 'function') {
    return fallbackHandler();
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
