import { canonicalPageHref } from './pageUrl.js';

function uniqueIds(ids) {
  const seen = new Set();
  const out = [];
  for (const raw of ids || []) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function readWorkspaceState() {
  const params = new URLSearchParams(window.location.search || '');
  const pageIds = uniqueIds((params.get('pages') || '').split(','));
  const activeId = String(params.get('active') || pageIds[0] || '');
  return { pageIds, activeId };
}

export function buildWorkspaceHref(pageIds, activeId = '') {
  const ids = uniqueIds(pageIds);
  const params = new URLSearchParams();
  if (ids.length) params.set('pages', ids.join(','));
  const chosenActive = activeId && ids.includes(activeId) ? activeId : (ids[0] || '');
  if (chosenActive) params.set('active', chosenActive);
  return `/workspace${params.toString() ? `?${params.toString()}` : ''}`;
}

export function buildEmbeddedPageHref(page) {
  const href = canonicalPageHref(page);
  const url = new URL(href, window.location.origin);
  url.searchParams.set('embed', '1');
  return `${url.pathname}${url.search}`;
}
