// Backwards-compatible user state helpers for mini apps, built on existing store.
import { getState, updateState, saveStateNow, reloadStateFromServer } from '../lib/state.js';

export function getUserState() {
  return getState();
}

export function patchUserState(partial) {
  // Merge + persist via existing debounced mechanism
  return updateState(partial);
}

// Expose immediate flush for callers that need synchronous persistence
export function flushUserState() { return saveStateNow(); }

// Reload user state from server (wrapper for miniapps callers)
export function reloadUserState() { return reloadStateFromServer(); }

// Namespaced app state with backwards compatibility.
export function getAppState(appId, fallback = undefined) {
  const s = getState() || {};
  const apps = s.apps || {};
  if (apps && apps[appId] !== undefined) return apps[appId];
  // Legacy compatibility for known apps
  if (appId === 'notepad') return s.notepadText ?? fallback;
  if (appId === 'todo') return s.todoItems ?? fallback;
  return fallback;
}

export function setAppState(appId, nextState) {
  const s = getState() || {};
  const apps = { ...(s.apps || {}) };
  apps[appId] = nextState;
  const patch = { apps };
  // Maintain legacy keys for backwards compatibility
  if (appId === 'notepad') patch.notepadText = nextState;
  if (appId === 'todo') {
    // If we moved to structured state { items, showCompleted }, provide a compatible legacy array
    if (nextState && Array.isArray(nextState.items)) {
      patch.todoItems = nextState.items.map(it => ({ text: it.text, done: !!it.done }));
    } else {
      patch.todoItems = nextState;
    }
  }
  return updateState(patch);
}
