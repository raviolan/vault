import { fetchJson } from '../lib/http.js';

export async function apiCreateBlock(pageId, { type, parentId = null, sort = 0, props = {}, content = {} }) {
  return fetchJson(`/api/pages/${encodeURIComponent(pageId)}/blocks`, {
    method: 'POST',
    body: JSON.stringify({ type, parentId, sort, props, content }),
  });
}

export async function apiPatchBlock(id, patch) {
  return fetchJson(`/api/blocks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function apiDeleteBlock(id) {
  return fetchJson(`/api/blocks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function apiReorder(pageId, moves) {
  return fetchJson('/api/blocks/reorder', {
    method: 'POST',
    body: JSON.stringify({ pageId, moves }),
  });
}

