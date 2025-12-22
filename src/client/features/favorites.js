import { $, escapeHtml } from '../lib/dom.js';
import { getState } from '../lib/state.js';
import { TOOLS, getToolById } from '../tools/index.js';

export function renderFavorites() {
  const ul = $('#navFav');
  if (!ul) return;
  const st = getState();
  const ids = Array.isArray(st.favoriteTools) ? st.favoriteTools : [];
  const items = ids.map(id => getToolById(id)).filter(Boolean);
  ul.innerHTML = items.map(t => `<li><a class="nav-item" href="${t.path}" data-link><span class="nav-text">${escapeHtml(t.name)}</span></a></li>`).join('');
}

