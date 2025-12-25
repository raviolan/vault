import { apiPatchBlock } from './apiBridge.js';

// Track pending debounced operations so we can flush them on demand.
const pending = Object.create(null); // blockId -> { timer, fn }

export function debouncePatch(blockId, patch, delay = 400) {
  const prev = pending[blockId];
  if (prev && prev.timer) clearTimeout(prev.timer);
  const fn = async () => {
    try {
      await apiPatchBlock(blockId, patch);
    } catch (e) {
      console.error('patch failed', e);
    } finally {
      delete pending[blockId];
    }
  };
  const timer = setTimeout(fn, delay);
  pending[blockId] = { timer, fn };
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
    try { await Promise.allSettled(toRun); } catch {}
  }
}
