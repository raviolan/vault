import { setCurrentPageBlocks } from '../../lib/pageStore.js';
import { fetchJson } from '../../lib/http.js';
export { apiCreateBlock, apiPatchBlock, apiDeleteBlock, apiReorder, apiMoveBlockSubtree } from '../api.js';

export async function refreshBlocksFromServer(pageId) {
  const page = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}`);
  if (!page || !Array.isArray(page.blocks)) {
    throw new Error(`Invalid page response while refreshing "${String(pageId)}"`);
  }
  setCurrentPageBlocks(page.blocks || []);
  return page;
}
