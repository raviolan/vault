import { apiPatchBlock } from './apiBridge.js';

// Track pending debounced operations so we can flush them on demand.
const pending = Object.create(null); // blockId -> { timer, fn }

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
  const prev = pending[blockId];
  if (prev && prev.timer) clearTimeout(prev.timer);
  const fn = async () => {
    try {
      await apiPatchBlock(blockId, patch);
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
  pending[blockId] = { timer, fn };
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
