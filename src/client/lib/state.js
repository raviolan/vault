// Simple in-memory UI state store with debounced server persistence

const DEFAULT_STATE = {
  leftPanelOpen: true,
  rightPanelOpen: true,
  rightPanelPinned: false,
  rightPanelTab: 'notepad',
  navCollapsed: false,
  notepadText: '',
  todoItems: [],
  surfaceMediaV1: { surfaces: {} },
  surfaceStyleV1: { surfaces: {} },
};

let state = { ...DEFAULT_STATE };
let loaded = false;
let saveTimer = null;
const SAVE_DELAY = 400; // ms

async function fetchJson(url, opts) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function loadState() {
  try {
    const srv = await fetchJson('/api/user/state');
    state = { ...DEFAULT_STATE, ...(srv || {}) };
  } catch {
    state = { ...DEFAULT_STATE };
  }
  loaded = true;
  return state;
}

export function getState() {
  return state;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetchJson('/api/user/state', { method: 'PUT', body: JSON.stringify(state) });
    } catch (e) {
      console.error('Failed to save state', e);
    }
  }, SAVE_DELAY);
}

export function updateState(patch) {
  state = { ...state, ...patch };
  if (loaded) scheduleSave();
  return state;
}

export function setState(next) {
  state = { ...DEFAULT_STATE, ...next };
  if (loaded) scheduleSave();
  return state;
}

// Flush/save immediately without debounce
export async function saveStateNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!loaded) return state;
  try {
    await fetchJson('/api/user/state', { method: 'PUT', body: JSON.stringify(state) });
  } catch (e) {
    console.error('Failed to save state (immediate)', e);
  }
  return state;
}

// Reload fresh state from the server and return it
export async function reloadStateFromServer() {
  await loadState();
  return state;
}
