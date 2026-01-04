import { apiPatchBlock } from './apiBridge.js';
import { parseMaybeJson } from '../tree.js';
import { countAnnotationTokens } from '../../lib/sanitize.js';
import { getCurrentPageBlocks, setCurrentPageBlocks, updateCurrentBlocks } from '../../lib/pageStore.js';

// Track pending debounced operations so we can flush them on demand.
// Structure: blockId -> { timer, fn, patch }
const pending = Object.create(null);

// Lightweight save status pub/sub for UI indicators
// States: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
let saveStatus = 'idle';
let hadErrorThisCycle = false;
const listeners = new Set();

function emitStatus() {
  for (const fn of listeners) {
    try { fn({ status: saveStatus, pendingCount: Object.keys(pending).length }); } catch {}
  }
}

function setStatus(next) {
  if (saveStatus !== next) {
    saveStatus = next;
    emitStatus();
  } else {
    // Still notify when pending count changes without status flip
    emitStatus();
  }
}

export function onSaveStatusChange(fn) {
  if (typeof fn === 'function') listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSaveStatus() {
  return { status: saveStatus, pendingCount: Object.keys(pending).length };
}

export function markDirty() {
  // Mark UI as having unsaved changes without altering debounce timing.
  if (saveStatus !== 'saving') setStatus('dirty');
}

export function debouncePatch(blockId, patch, delay = 400) {
  // Merge helper: combine root keys with last-write-wins and shallow-merge props/content
  function mergePatch(a = {}, b = {}) {
    const out = { ...(a || {}) };
    // root last-write-wins if provided in b
    for (const k of ['type', 'parentId', 'sort']) {
      if (b[k] !== undefined) out[k] = b[k];
    }
    // props/content shallow merge
    if (b.props !== undefined) out.props = { ...(a?.props || {}), ...(b.props || {}) };
    if (b.content !== undefined) out.content = { ...(a?.content || {}), ...(b.content || {}) };
    return out;
  }

  const prev = pending[blockId];
  // Merge with any pending patch for this block
  const mergedPatch = prev && prev.patch ? mergePatch(prev.patch, patch || {}) : (patch || {});

  // Apply optimistic update to the local store immediately
  try {
    const blocks = getCurrentPageBlocks();
    const idx = blocks.findIndex(b => b.id === blockId);
    if (idx >= 0) {
      const cur = blocks[idx];
      let next = { ...cur };
      if (mergedPatch.type !== undefined) next.type = String(mergedPatch.type);
      if (mergedPatch.parentId !== undefined) next.parentId = mergedPatch.parentId ?? null;
      if (mergedPatch.sort !== undefined) next.sort = Number(mergedPatch.sort) || 0;
      if (mergedPatch.props !== undefined) {
        const curProps = parseMaybeJson(cur.propsJson);
        const mergedProps = { ...(curProps || {}), ...(mergedPatch.props || {}) };
        // Always store JSON string form in blocks list
        next.propsJson = JSON.stringify(mergedProps);
      }
      if (mergedPatch.content !== undefined) {
        const curContent = parseMaybeJson(cur.contentJson);
        const mergedContent = { ...(curContent || {}), ...(mergedPatch.content || {}) };
        next.contentJson = JSON.stringify(mergedContent);
      }
      // commit local update
      const copy = blocks.slice();
      copy[idx] = next;
      setCurrentPageBlocks(copy);
    }
  } catch {}

  if (prev && prev.timer) clearTimeout(prev.timer);
  const fn = async () => {
    try {
      // Fetch latest local block snapshot
      const blocks = getCurrentPageBlocks();
      const cur = blocks.find(b => b.id === blockId);
      if (!cur) {
        // Block removed from store; cancel quietly
        return;
      }
      // Build finalPatch by merging pending patch into the latest JSON
      const pendingPatch = pending[blockId]?.patch || mergedPatch || {};
      const finalPatch = {};
      if (pendingPatch.type !== undefined) finalPatch.type = pendingPatch.type;
      if (pendingPatch.parentId !== undefined) finalPatch.parentId = pendingPatch.parentId ?? null;
      if (pendingPatch.sort !== undefined) finalPatch.sort = Number(pendingPatch.sort) || 0;
      if (pendingPatch.props !== undefined) {
        const latestProps = parseMaybeJson(cur.propsJson);
        finalPatch.props = { ...(latestProps || {}), ...(pendingPatch.props || {}) };
      }
      if (pendingPatch.content !== undefined) {
        const latestContent = parseMaybeJson(cur.contentJson);
        finalPatch.content = { ...(latestContent || {}), ...(pendingPatch.content || {}) };
      }

      // Data-loss guard: if tokens drop from >0 to 0 unexpectedly, refuse to save
      try {
        const prevText = String(parseMaybeJson(cur.contentJson)?.text || '');
        const nextText = (finalPatch?.content && 'text' in finalPatch.content)
          ? String(finalPatch.content.text || '')
          : prevText;
        const before = countAnnotationTokens(prevText);
        const after = countAnnotationTokens(nextText);
        const droppedAll = (before.total > 0 && after.total === 0);
        if (droppedAll && prevText !== nextText) {
          // Abort this patch; keep local optimistic changes reverted to server truth
          console.error('[guard] Refusing to save: would delete annotations', { blockId, before, after });
          alert('Refusing to save because it would delete existing links/comments. Please reload.');
          // Reset pending for this block without calling API
          return;
        }
      } catch {}

      const updated = await apiPatchBlock(blockId, finalPatch);
      // Update local store with server-confirmed fields
      try {
        setCurrentPageBlocks(getCurrentPageBlocks().map(b => (
          b.id === blockId
            ? {
                ...b,
                parentId: (updated?.parentId !== undefined ? updated.parentId : b.parentId),
                sort: (updated?.sort !== undefined ? updated.sort : b.sort),
                type: (updated?.type !== undefined ? updated.type : b.type),
                propsJson: (updated?.propsJson !== undefined ? updated.propsJson : b.propsJson),
                contentJson: (updated?.contentJson !== undefined ? updated.contentJson : b.contentJson),
                updatedAt: updated?.updatedAt || b.updatedAt,
              }
            : b
        )));
      } catch {}
      // If this completes and no other pending remains and no error flagged,
      // consider the cycle successfully saved.
    } catch (e) {
      console.error('patch failed', e);
      hadErrorThisCycle = true;
      setStatus('error');
    } finally {
      delete pending[blockId];
      // If we finished the last pending op, update final status
      if (!Object.keys(pending).length) {
        if (!hadErrorThisCycle) setStatus('saved');
        // Reset error flag for the next cycle
        hadErrorThisCycle = false;
      } else {
        emitStatus();
      }
    }
  };
  const timer = setTimeout(fn, delay);
  pending[blockId] = { timer, fn, patch: mergedPatch };
  // New/updated pending work means we're saving
  hadErrorThisCycle = false; // start fresh on new cycle
  setStatus('saving');
}

export async function flushDebouncedPatches() {
  const toRun = [];
  for (const k of Object.keys(pending)) {
    const entry = pending[k];
    try { if (entry?.timer) clearTimeout(entry.timer); } catch {}
    if (typeof entry?.fn === 'function') toRun.push(entry.fn());
    delete pending[k];
  }
  if (toRun.length) {
    // Indicate saving while flushing
    setStatus('saving');
    hadErrorThisCycle = false;
    try {
      const results = await Promise.allSettled(toRun);
      const anyRejected = results.some(r => r.status === 'rejected');
      if (anyRejected) {
        hadErrorThisCycle = true;
        setStatus('error');
      } else {
        setStatus('saved');
      }
    } catch {
      hadErrorThisCycle = true;
      setStatus('error');
    } finally {
      hadErrorThisCycle = false;
    }
  }
}

// Convenience helper to persist a block patch immediately through the same pipeline
// Applies optimistic update, then flushes pending work to the server and updates the store
export async function patchBlockNow(blockId, patch) {
  try {
    debouncePatch(blockId, patch || {}, 0);
    await flushDebouncedPatches();
  } catch (e) {
    // Ensure error does not break caller flows
    console.error('patchBlockNow failed', e);
    throw e;
  }
}
