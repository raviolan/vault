import { getState, updateState } from '../../lib/state.js';
import { updateFavoriteButton } from './render.js';

const TOOL_ID = 'enemy-generator';

export function isFavorited() {
  const st = getState();
  const arr = Array.isArray(st.favoriteTools) ? st.favoriteTools : [];
  return arr.includes(TOOL_ID);
}

export function toggleFavorite() {
  const st = getState();
  const arr = Array.isArray(st.favoriteTools) ? st.favoriteTools.slice() : [];
  const idx = arr.indexOf(TOOL_ID);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(TOOL_ID);
  updateState({ favoriteTools: arr });
  updateFavoriteButton(arr.includes(TOOL_ID));
}
