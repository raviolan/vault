// Simple shared store for per-page sheet JSON
// Caches GETs and emits a global event after successful PATCH.
// Event: 'vault:page-sheet-updated' with detail: { pageId, sheet }
//
// Cross-tab sync: after successful patch, broadcast via BroadcastChannel
// and localStorage so other tabs can update their caches and re-emit
// the same local event without re-patching or looping.

import { fetchJson } from './http.js';

const cache = new Map(); // pageId -> { sheet, ts }
const inflight = new Map(); // pageId -> Promise

// ------- Cross-tab setup
const STORAGE_KEY = 'vault:sheet-update';
const CHANNEL_NAME = 'vault-sheet';

// Unique per-tab/session source id
const sourceId = (() => {
  try { return (crypto && crypto.randomUUID && crypto.randomUUID()) || `src-${Date.now()}-${Math.random().toString(16).slice(2)}`; } catch { return `src-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
})();

// Broadcast channel (if available)
let bc = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    bc = new BroadcastChannel(CHANNEL_NAME);
    bc.onmessage = (ev) => {
      try { handleIncoming(ev?.data); } catch {}
    };
  }
} catch {}

// Storage listener fallback
try {
  window.addEventListener('storage', (e) => {
    try {
      if (!e || e.key !== STORAGE_KEY) return;
      if (!e.newValue) return;
      const data = JSON.parse(e.newValue);
      handleIncoming(data);
    } catch {}
  });
} catch {}

function handleIncoming(msg) {
  if (!msg || msg.type !== 'sheet-updated') return;
  if (msg.sourceId && msg.sourceId === sourceId) return; // ignore own messages
  const id = String(msg.pageId || '');
  if (!id) return;
  const sheet = (msg.sheet && typeof msg.sheet === 'object') ? msg.sheet : {};
  cache.set(id, { sheet, ts: Date.now() });
  try { window.dispatchEvent(new CustomEvent('vault:page-sheet-updated', { detail: { pageId: id, sheet } })); } catch {}
}

function broadcastSheetUpdate(pageId, sheet) {
  const payload = {
    type: 'sheet-updated',
    pageId: String(pageId),
    sheet: sheet || {},
    sourceId,
    ts: Date.now(),
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
  // BroadcastChannel
  try { if (bc) bc.postMessage(payload); } catch {}
  // localStorage fallback (fires storage event in other tabs)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch {}
}

export async function getPageSheet(pageId) {
  const id = String(pageId);
  const entry = cache.get(id);
  if (entry?.sheet) return entry.sheet;
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    try {
      const resp = await fetchJson(`/api/pages/${encodeURIComponent(id)}/sheet`);
      const sheet = resp?.sheet || {};
      cache.set(id, { sheet, ts: Date.now() });
      return sheet;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

export async function patchPageSheet(pageId, patch) {
  const id = String(pageId);
  const resp = await fetchJson(`/api/pages/${encodeURIComponent(id)}/sheet`, {
    method: 'PATCH',
    body: JSON.stringify(patch || {}),
  });
  const sheet = resp?.sheet || {};
  cache.set(id, { sheet, ts: Date.now() });
  try { window.dispatchEvent(new CustomEvent('vault:page-sheet-updated', { detail: { pageId: id, sheet } })); } catch {}
  // Cross-tab broadcast
  try { broadcastSheetUpdate(id, sheet); } catch {}
  return sheet;
}

export function setPageSheetCache(pageId, sheet) {
  const id = String(pageId);
  cache.set(id, { sheet: sheet || {}, ts: Date.now() });
}
