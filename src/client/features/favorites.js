import { $, escapeHtml } from '../lib/dom.js';
import { getState } from '../lib/state.js';
import { patchUserState } from '../miniapps/state.js';
import { getToolById } from '../tools/index.js';

export function renderFavorites() {
  const ul = $('#navFav');
  if (!ul) return;
  const st = getState();
  // Tools favorites (existing behavior)
  const ids = Array.isArray(st.favoriteTools) ? st.favoriteTools : [];
  // Page favorites (new)
  const pageFavs = Array.isArray(st.favorites) ? st.favorites : [];

  const pageLis = pageFavs.map(fp => {
    const href = String(fp?.href || '#');
    const title = escapeHtml(String(fp?.title || href));
    return `<li class="favorites-row"><a class="nav-item fav-link" href="${href}" data-link><span class=\"nav-text\">${title}</span></a><button type="button" class="fav-remove" aria-label="Remove from favorites" title="Remove" data-href="${href}">×</button></li>`;
  });
  const toolLis = ids.map(id => {
    const t = getToolById(id);
    if (!t) return '';
    return `<li class="favorites-row"><a class="nav-item fav-link" href="${t.path}" data-link><span class="nav-text">${escapeHtml(t.name)}</span></a><button type="button" class="fav-remove" aria-label="Remove from favorites" title="Remove" data-tool-id="${escapeHtml(id)}">×</button></li>`;
  });
  ul.innerHTML = [...pageLis, ...toolLis].filter(Boolean).join('');

  // Delegate remove clicks; keep only one listener
  if (!ul._favRemoveBound) {
    ul.addEventListener('click', async (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.classList.contains('fav-remove')) return;
      e.preventDefault();
      e.stopPropagation();

      const href = target.getAttribute('data-href');
      const toolId = target.getAttribute('data-tool-id');
      const stNow = getState();
      try {
        if (href) {
          const prev = Array.isArray(stNow.favorites) ? stNow.favorites : [];
          const next = prev.filter(it => String(it?.href) !== href);
          await patchUserState({ favorites: next });
        } else if (toolId) {
          const prev = Array.isArray(stNow.favoriteTools) ? stNow.favoriteTools : [];
          const next = prev.filter(id => id !== toolId);
          await patchUserState({ favoriteTools: next });
        }
      } catch {}
      // Re-render Favorites UI
      try { renderFavorites(); } catch {}
    });
    ul._favRemoveBound = true;
  }
}
