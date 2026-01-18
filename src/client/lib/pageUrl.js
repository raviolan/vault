export function canonicalPageHref(page) {
  try {
    if (page && page.slug) return `/p/${encodeURIComponent(page.slug)}`;
    if (page && page.id) return `/page/${encodeURIComponent(page.id)}`;
  } catch {}
  return '/';
}

// Resolve a page id to a canonical href. Accepts a fetchJson function and optional cache Map(id->page).
export async function canonicalHrefForPageId(pageId, fetchJson, cacheMap) {
  if (!pageId) return '/';
  try {
    const cached = cacheMap?.get?.(pageId);
    if (cached && cached.slug) return `/p/${encodeURIComponent(cached.slug)}`;
  } catch {}
  try {
    const p = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}`);
    if (cacheMap && p?.id) {
      try { cacheMap.set(p.id, p); } catch {}
    }
    return p?.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(pageId)}`;
  } catch {
    return `/page/${encodeURIComponent(pageId)}`;
  }
}

