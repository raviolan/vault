import { setCurrentPageBlocks } from '../../lib/pageStore.js';
export { apiCreateBlock, apiPatchBlock, apiDeleteBlock, apiReorder } from '../api.js';

export async function refreshBlocksFromServer(pageId) {
  const res = await fetch(`/api/pages/${encodeURIComponent(pageId)}`);
  const page = await res.json();
  setCurrentPageBlocks(page.blocks || []);
}

